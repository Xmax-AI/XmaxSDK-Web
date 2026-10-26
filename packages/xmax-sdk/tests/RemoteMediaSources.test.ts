import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { RemoteAudioFrameSource } from "../src/Foundation/Media/Audio/RemoteAudioFrameSource";
import { RemoteVideoFrameSource } from "../src/Foundation/Media/Video/RemoteVideoFrameSource";

class Track extends EventTarget {
  readyState = "live";
  stop = vi.fn();
}

function audioEnvironment() {
  const nodes: Worklet[] = [];
  const contexts: Context[] = [];
  const load = vi.fn(async (_url: string) => {});
  const resume = vi.fn(async () => {});
  class Node {
    connect = vi.fn();
    disconnect = vi.fn();
  }
  class Worklet extends Node {
    port = { onmessage: undefined as ((event: { data: unknown }) => void) | null | undefined, close: vi.fn() };
    constructor() { super(); nodes.push(this); }
  }
  class Context {
    state = "running";
    currentTime = 1;
    destination = {};
    audioWorklet = { addModule: load };
    gain = Object.assign(new Node(), { gain: { value: 1 } });
    sources: Node[] = [];
    resume = resume;
    close = vi.fn(async () => { this.state = "closed"; });
    getOutputTimestamp = vi.fn(() => ({ contextTime: 1, performanceTime: 5000 }));
    createMediaStreamSource() { const node = new Node(); this.sources.push(node); return node; }
    createGain() { return this.gain; }
    constructor() { contexts.push(this); }
  }
  vi.stubGlobal("AudioContext", Context);
  vi.stubGlobal("AudioWorkletNode", Worklet);
  vi.stubGlobal("MediaStream", class { constructor(readonly tracks: unknown[]) {} });
  vi.spyOn(URL, "createObjectURL").mockReturnValue("blob:remote-audio");
  vi.spyOn(URL, "revokeObjectURL").mockImplementation(() => {});
  const packet = (frameIndex = 48000, overrides = {}) => ({
    data: new ArrayBuffer(1920), sampleRate: 48000, channels: 1,
    samplesPerChannel: 960, frameIndex, discontinuous: false, ...overrides,
  });
  return { nodes, contexts, load, resume, packet };
}

describe("remote audio frame source", () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => { vi.useRealTimers(); vi.unstubAllGlobals(); vi.restoreAllMocks(); });

  it("uses sample time on the shared presentation clock, not main-thread delivery time", async () => {
    const s = audioEnvironment();
    const source = new RemoteAudioFrameSource();
    await source.prepare(new AbortController().signal);
    const track = new Track();
    const listener = vi.fn();
    source.setTrack(track as unknown as MediaStreamTrack, listener);
    expect(s.contexts[0]!.gain.gain.value).toBe(0);
    s.nodes[0]!.port.onmessage!({ data: s.packet() });
    vi.spyOn(performance, "now").mockReturnValue(100_000);
    s.nodes[0]!.port.onmessage!({ data: s.packet(48960) });
    expect(listener.mock.calls.map(call => call[0].presentationTimeStamp)).toEqual([5_000_000, 5_020_000]);
    expect(listener.mock.calls.map(call => call[0].discontinuous)).toEqual([true, false]);
    expect(listener.mock.calls[0]![0].data).toBeInstanceOf(Uint8Array);
    s.nodes[0]!.port.onmessage!({ data: s.packet(96000) });
    expect(listener).toHaveBeenLastCalledWith(expect.objectContaining({ presentationTimeStamp: 6_000_000, discontinuous: true }));
    await source.close();
    expect(track.stop).not.toHaveBeenCalled();
    expect(s.nodes[0]!.port.close).toHaveBeenCalledOnce();
    expect(s.contexts[0]!.close).toHaveBeenCalledOnce();
    expect(URL.revokeObjectURL).toHaveBeenCalledWith("blob:remote-audio");
  });

  it("discards old port messages after replacement, end or close", async () => {
    const s = audioEnvironment();
    const source = new RemoteAudioFrameSource();
    await source.prepare(new AbortController().signal);
    const first = new Track(), second = new Track(), listener = vi.fn();
    source.setTrack(first as unknown as MediaStreamTrack, listener);
    const stale = s.nodes[0]!.port.onmessage!;
    source.setTrack(second as unknown as MediaStreamTrack, listener);
    stale({ data: s.packet() });
    expect(listener).not.toHaveBeenCalled();
    s.nodes[1]!.port.onmessage!({ data: s.packet() });
    expect(listener).toHaveBeenLastCalledWith(expect.objectContaining({ discontinuous: true }));
    const ended = s.nodes[1]!.port.onmessage!;
    second.dispatchEvent(new Event("ended"));
    ended({ data: s.packet() });
    expect(listener).toHaveBeenCalledOnce();
    await source.close();
    expect(first.stop).not.toHaveBeenCalled();
    expect(second.stop).not.toHaveBeenCalled();
  });

  it("ignores missing audio and malformed packets, marking later output discontinuous", async () => {
    const s = audioEnvironment();
    const source = new RemoteAudioFrameSource();
    await source.prepare(new AbortController().signal);
    const listener = vi.fn();
    source.setTrack(undefined, listener);
    expect(s.nodes).toHaveLength(0);
    source.setTrack(new Track() as unknown as MediaStreamTrack, listener);
    const emit = s.nodes[0]!.port.onmessage!;
    emit({ data: s.packet() });
    for (const value of [null, {}, s.packet(0, { sampleRate: 0 }), s.packet(0, { channels: 3 }), s.packet(0, { data: new ArrayBuffer(2) })]) {
      emit({ data: value });
    }
    emit({ data: s.packet(48960) });
    expect(listener).toHaveBeenCalledTimes(2);
    expect(listener.mock.calls[1]![0].discontinuous).toBe(true);
    await source.close();
  });

  it("uses the audio context clock when an output timestamp is unavailable", async () => {
    const s = audioEnvironment();
    const source = new RemoteAudioFrameSource();
    await source.prepare(new AbortController().signal);
    s.contexts[0]!.getOutputTimestamp.mockReturnValue({ contextTime: 0, performanceTime: 0 });
    vi.spyOn(performance, "now").mockReturnValue(5000);
    const listener = vi.fn();
    source.setTrack(new Track() as unknown as MediaStreamTrack, listener);
    s.nodes[0]!.port.onmessage!({ data: s.packet() });
    expect(listener.mock.calls[0]![0].presentationTimeStamp).toBe(5_000_000);
    await source.close();
  });

  it.each(["failure", "cancel", "timeout"])("releases failed initialization: %s", async mode => {
    const s = audioEnvironment();
    const source = new RemoteAudioFrameSource();
    const abort = new AbortController();
    if (mode === "failure") s.load.mockRejectedValue(new Error("blocked worklet"));
    else s.resume.mockReturnValue(new Promise(() => {}));
    const result = source.prepare(abort.signal);
    const rejected = expect(result).rejects.toThrow(mode === "failure" ? "blocked worklet" : mode === "cancel" ? "cancelled" : "timed out");
    if (mode === "cancel") abort.abort();
    if (mode === "timeout") await vi.advanceTimersByTimeAsync(3000);
    await rejected;
    expect(s.contexts[0]!.close).toHaveBeenCalledOnce();
    expect(URL.revokeObjectURL).toHaveBeenCalledOnce();
    expect(vi.getTimerCount()).toBe(0);
  });
});

class Video {
  style = {};
  videoWidth = 320;
  videoHeight = 180;
  srcObject: unknown = null;
  muted = false;
  playsInline = false;
  autoplay = false;
  callbacks = new Map<number, VideoFrameRequestCallback>();
  sequence = 0;
  play = vi.fn(async () => {});
  pause = vi.fn();
  remove = vi.fn();
  setAttribute = vi.fn();
  requestVideoFrameCallback(callback: VideoFrameRequestCallback) { this.callbacks.set(++this.sequence, callback); return this.sequence; }
  cancelVideoFrameCallback(id: number) { this.callbacks.delete(id); }
  emit(displayTime = 5000, presentedFrames = 1, mediaTime = 0) {
    const callbacks = [...this.callbacks.values()]; this.callbacks.clear();
    for (const callback of callbacks) callback(displayTime, { expectedDisplayTime: displayTime, presentedFrames, mediaTime } as VideoFrameCallbackMetadata);
  }
}

describe("remote video frame source", () => {
  afterEach(() => { vi.unstubAllGlobals(); vi.restoreAllMocks(); });

  function setup() {
    const video = new Video();
    class Frame {
      close = vi.fn();
      displayWidth = 320;
      displayHeight = 180;
      timestamp: number;
      duration?: number;
      constructor(_source: unknown, options: { timestamp: number; duration?: number }) { this.timestamp = options.timestamp; this.duration = options.duration; }
    }
    vi.stubGlobal("HTMLVideoElement", Video);
    vi.stubGlobal("VideoFrame", Frame);
    vi.stubGlobal("MediaStream", class { constructor(readonly tracks: unknown[]) {} });
    vi.stubGlobal("document", { createElement: vi.fn(() => video), body: { appendChild: vi.fn() } });
    return video;
  }

  it("copies raw frames, exposes gaps and Safari's constant mediaTime without altering playback", () => {
    const video = setup(), source = new RemoteVideoFrameSource();
    const track = new Track(), listener = vi.fn(), error = vi.fn();
    source.start(track as unknown as MediaStreamTrack, listener, error);
    expect(video.muted).toBe(true);
    video.emit(5000, 1);
    video.emit(5033, 2);
    video.emit(5500, 5);
    expect(listener.mock.calls.map(call => call[0].frame.timestamp)).toEqual([5_000_000, 5_033_000, 5_500_000]);
    expect(listener.mock.calls.map(call => call[0].discontinuous)).toEqual([true, false, true]);
    expect(listener.mock.calls[2]![0].frame.duration).toBe(467_000);
    expect(error).not.toHaveBeenCalled();
    source.stop();
    expect(video.srcObject).toBeNull();
    expect(video.remove).toHaveBeenCalledOnce();
    expect(track.stop).not.toHaveBeenCalled();
  });

  it("rejects stale callbacks and releases the element when the track ends", () => {
    const video = setup(), source = new RemoteVideoFrameSource();
    const track = new Track(), listener = vi.fn();
    source.start(track as unknown as MediaStreamTrack, listener, vi.fn());
    const late = [...video.callbacks.values()][0]!;
    track.dispatchEvent(new Event("ended"));
    late(5000, { expectedDisplayTime: 5000 } as VideoFrameCallbackMetadata);
    expect(listener).not.toHaveBeenCalled();
    expect(video.callbacks.size).toBe(0);
    expect(video.srcObject).toBeNull();
    expect(track.stop).not.toHaveBeenCalled();
  });

  it("closes a copied frame when handing it off fails", () => {
    const video = setup(), source = new RemoteVideoFrameSource();
    const error = vi.fn();
    let copied: VideoFrame | undefined;
    source.start(new Track() as unknown as MediaStreamTrack, packet => {
      copied = packet.frame;
      throw new Error("handoff failed");
    }, error);

    video.emit();
    expect(copied!.close).toHaveBeenCalledOnce();
    expect(error).toHaveBeenCalledWith(expect.objectContaining({ message: "handoff failed" }));
    source.stop();
  });

  it("fails explicitly on unsupported browsers without allocating media", () => {
    setup();
    vi.stubGlobal("VideoFrame", undefined);
    expect(() => new RemoteVideoFrameSource().start(new Track() as unknown as MediaStreamTrack, vi.fn(), vi.fn())).toThrow("require VideoFrame");
    expect(document.createElement).not.toHaveBeenCalled();
  });
});
