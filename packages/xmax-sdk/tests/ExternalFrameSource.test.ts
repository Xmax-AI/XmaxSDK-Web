import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ExternalFrameSink } from "../src/Media/External/ExternalFrameSink";
import type { RealtimeExternalAudioFrame as AudioData } from "../src/Foundation/Media/Audio/RealtimeExternalAudioFrame";
import { ExternalFrameSourceController } from "../src/Media/External/ExternalFrameSourceController";
import type { RealtimeExternalVideoSource, RealtimeExternalFrameSink } from "../src/Media/External/RealtimeExternalVideoSource";
import { RealtimeVideoFormat } from "../src/Service/Realtime/RealtimeVideoFormat";
import { MediaService } from "../src/Service/Media/MediaService";
import { VideoRenderRegistry } from "../src/Service/Realtime/VideoRenderBinding";
import { VideoContentMode } from "../src/Foundation/Media/Video/VideoContentMode";

const sourceFormat = new RealtimeVideoFormat({ width: 3840, height: 2160, fps: 30 });
const resolved = sourceFormat.resized(1920, 1080);

function frame(timestamp = 0, width = sourceFormat.width, height = sourceFormat.height) {
  const copy = { close: vi.fn() } as unknown as VideoFrame;
  return { timestamp, displayWidth: width, displayHeight: height, close: vi.fn(), clone: vi.fn(() => copy), copy };
}

describe("external frame sink", () => {
  beforeEach(() => { vi.useFakeTimers(); vi.spyOn(performance, "now").mockReturnValue(1000); });
  afterEach(() => { vi.useRealTimers(); vi.restoreAllMocks(); });

  function setup(audio?: any) {
    const context = { drawImage: vi.fn() }, track = { requestFrame: vi.fn() }, error = vi.fn();
    const sink = new ExternalFrameSink(resolved, sourceFormat, context as unknown as CanvasRenderingContext2D,
      track as unknown as CanvasCaptureMediaStreamTrack, audio, error);
    return { sink, context, track, error };
  }

  it("retains a copy, scales to resolved media size, and leaves caller ownership unchanged", async () => {
    const s = setup(), input = frame();
    s.sink.pushVideo(input as unknown as VideoFrame);
    expect(input.clone).toHaveBeenCalledOnce();
    expect(input.close).not.toHaveBeenCalled();
    expect(s.context.drawImage).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(20);
    expect(s.context.drawImage).toHaveBeenCalledWith(input.copy, 0, 0, 1920, 1080);
    expect(input.copy.close).toHaveBeenCalledOnce();
    expect(s.track.requestFrame).toHaveBeenCalledOnce();
    s.sink.invalidate();
  });

  it("ignores invalid or backward timestamps, bounds pending video and rejects stale sinks", async () => {
    const s = setup(), first = frame(), second = frame(33_333);
    s.sink.pushVideo(first as unknown as VideoFrame);
    for (const timestamp of [-1, NaN, Infinity, 0, 0.5]) {
      const ignored = frame(timestamp);
      s.sink.pushVideo(ignored as unknown as VideoFrame);
      expect(ignored.clone).not.toHaveBeenCalled();
    }
    s.sink.pushVideo(second as unknown as VideoFrame);
    expect(first.copy.close).not.toHaveBeenCalled();
    s.sink.invalidate();
    expect(first.copy.close).toHaveBeenCalledOnce();
    expect(second.copy.close).toHaveBeenCalledOnce();
    const stale = frame(66_666);
    s.sink.pushVideo(stale as unknown as VideoFrame);
    expect(stale.clone).not.toHaveBeenCalled();
    await vi.runAllTimersAsync();
    expect(s.context.drawImage).not.toHaveBeenCalled();
    expect(s.sink.isRequestingFrames).toBe(false);
  });

  it("does not postpone presentation when new frames arrive before an audio-clock deadline", async () => {
    const s = setup({ nowUs: 0, reset: vi.fn(), setPublished: vi.fn() });
    const first = frame(), second = frame(33_333), latest = frame(66_666);
    s.sink.pushVideo(first as unknown as VideoFrame);
    await vi.advanceTimersByTimeAsync(10);
    s.sink.pushVideo(second as unknown as VideoFrame);
    s.sink.pushVideo(latest as unknown as VideoFrame);
    expect(second.copy.close).toHaveBeenCalledOnce();
    await vi.advanceTimersByTimeAsync(10);
    expect(s.context.drawImage).toHaveBeenCalledWith(first.copy, 0, 0, 1920, 1080);
    s.sink.invalidate();
    expect(latest.copy.close).toHaveBeenCalledOnce();
  });

  it("reports malformed dimensions, far-future source times and render failures only once", async () => {
    for (const mode of ["size", "future", "render"]) {
      const s = setup();
      s.sink.pushVideo(frame() as unknown as VideoFrame);
      if (mode === "size") s.sink.pushVideo(frame(1, 320, 180) as unknown as VideoFrame);
      if (mode === "future") s.sink.pushVideo(frame(3_000_000) as unknown as VideoFrame);
      if (mode === "render") {
        s.context.drawImage.mockImplementationOnce(() => { throw new Error("render failed"); });
        await vi.runAllTimersAsync();
      }
      s.sink.reportError(new Error("again"));
      expect(s.error).toHaveBeenCalledOnce();
      expect(s.sink.isRequestingFrames).toBe(false);
    }
  });

  it("maps both tracks onto one audio clock, reanchors after stalls and ignores audio without opt-in", () => {
    const audio = { nowUs: 5_000_000, reset: vi.fn(), setPublished: vi.fn(), push: vi.fn((_frame, map) => map(100_000)) };
    const s = setup(audio);
    s.sink.pushVideo(frame(100_000) as unknown as VideoFrame);
    const input = {} as AudioData;
    s.sink.pushAudio(input);
    expect(audio.push.mock.results[0]!.value).toBe(5_020_000);
    audio.nowUs = 10_000_000;
    s.sink.pushVideo(frame(133_333) as unknown as VideoFrame);
    expect(audio.reset).toHaveBeenCalledTimes(2);
    s.sink.invalidate();
    expect(audio.setPublished).toHaveBeenCalledWith(false);
    s.sink.pushAudio(input);
    expect(audio.push).toHaveBeenCalledOnce();
    const silent = setup();
    expect(() => silent.sink.pushAudio(input)).not.toThrow();
    silent.sink.invalidate();
  });
});

class Track extends EventTarget {
  readyState = "live";
  requestFrame = vi.fn();
  stop = vi.fn(() => { this.readyState = "ended"; this.dispatchEvent(new Event("ended")); });
}

describe("external frame source lifecycle", () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => { vi.useRealTimers(); vi.unstubAllGlobals(); vi.restoreAllMocks(); });

  function setup() {
    const track = new Track();
    const stream = { getVideoTracks: () => [track], getTracks: () => [track] };
    const context = { drawImage: vi.fn() };
    const canvas = { width: 0, height: 0, getContext: () => context, captureStream: vi.fn(() => stream) };
    vi.stubGlobal("document", { createElement: vi.fn(() => canvas) });
    vi.stubGlobal("VideoFrame", class {});
    const error = vi.fn(), controller = new ExternalFrameSourceController(error);
    let sink: RealtimeExternalFrameSink | undefined;
    const source = { videoFormat: sourceFormat, start: vi.fn(async (value: RealtimeExternalFrameSink) => { sink = value; }), stop: vi.fn(async () => {}) };
    const create = () => controller.create(source, new MediaService(), new AbortController().signal);
    return { track, stream, context, canvas, error, controller, source, create, sink: () => sink! };
  }

  it("returns before the first frame, supports previews, and stops once without owning caller devices", async () => {
    const s = setup(), local = await s.create();
    expect(s.controller.isActive).toBe(true);
    expect(local.videoTrack?.videoFormat).toEqual(resolved);
    expect(sourceFormat).toMatchObject({ width: 3840, height: 2160 });
    expect(s.controller.audioTrack).toBeUndefined();
    const view = { isMirrored: true, setMediaStream: vi.fn() };
    VideoRenderRegistry.binding(local.videoTrack!)!.attachHandler(view, VideoContentMode.fit);
    expect(view.isMirrored).toBe(false);
    expect(view.setMediaStream).toHaveBeenCalledWith(s.stream);
    await s.controller.stop();
    await s.controller.stop();
    expect(s.source.stop).toHaveBeenCalledOnce();
    expect(s.sink().isRequestingFrames).toBe(false);
    expect(s.track.stop).toHaveBeenCalledOnce();
    expect(view.setMediaStream).toHaveBeenLastCalledWith(null);
    expect(VideoRenderRegistry.binding(local.videoTrack!)).toBeUndefined();
    expect(s.controller.isActive).toBe(false);
    expect(s.canvas).toMatchObject({ width: 0, height: 0 });
    expect(s.error).not.toHaveBeenCalled();
  });

  it("rejects duplicate attachment and calls stop on startup failure", async () => {
    const s = setup();
    await s.create();
    await expect(s.create()).rejects.toThrow("Close the current");
    await s.controller.stop();
    const failed = setup();
    failed.source.start.mockRejectedValueOnce(new Error("capture failed"));
    await expect(failed.create()).rejects.toThrow("capture failed");
    expect(failed.source.stop).toHaveBeenCalledOnce();
    expect(failed.track.stop).toHaveBeenCalledOnce();
    expect(failed.source.start.mock.calls[0]![0].isRequestingFrames).toBe(false);
  });

  it("cancels a pending start without waiting for the source to cooperate, rejecting late input", async () => {
    const s = setup(), abort = new AbortController();
    let finish!: () => void;
    s.source.start.mockImplementationOnce(async value => { (s.source as any).oldSink = value; await new Promise<void>(resolve => { finish = resolve; }); });
    const pending = s.controller.create(s.source, new MediaService(), abort.signal);
    const rejected = expect(pending).rejects.toMatchObject({ code: "CANCELLED" });
    abort.abort();
    await rejected;
    const oldSink = (s.source as any).oldSink as RealtimeExternalFrameSink;
    const late = frame(); oldSink.pushVideo(late as unknown as VideoFrame);
    expect(late.clone).not.toHaveBeenCalled();
    expect(s.source.stop).toHaveBeenCalledOnce();
    finish();
    await Promise.resolve();
    expect(s.controller.isActive).toBe(false);
    expect(vi.getTimerCount()).toBe(0);
  });

  it("bounds hung start and stop callbacks and still releases local media", async () => {
    const s = setup();
    s.source.start.mockReturnValueOnce(new Promise(() => {}));
    const rejected = expect(s.create()).rejects.toMatchObject({ code: "TIMEOUT" });
    await vi.advanceTimersByTimeAsync(10_000);
    await rejected;
    expect(s.source.stop).toHaveBeenCalledOnce();
    const hung = setup();
    await hung.create();
    hung.source.stop.mockReturnValueOnce(new Promise(() => {}));
    const stop = hung.controller.stop();
    await vi.advanceTimersByTimeAsync(2000);
    await stop;
    expect(hung.track.stop).toHaveBeenCalledOnce();
    expect(hung.controller.isActive).toBe(false);
    expect(vi.getTimerCount()).toBe(0);
  });

  it("fails without leaking resources if the source reports an error during start", async () => {
    const s = setup();
    s.source.start.mockImplementationOnce(async sink => sink.reportError(new Error("broken source")));
    await expect(s.create()).rejects.toThrow("no longer attached");
    expect(s.error).toHaveBeenCalledWith(expect.objectContaining({ message: "External source failed: broken source" }));
    expect(s.source.stop).toHaveBeenCalledOnce();
    expect(s.track.stop).toHaveBeenCalledOnce();
  });
});
