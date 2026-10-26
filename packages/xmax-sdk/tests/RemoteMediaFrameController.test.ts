import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { RemoteMediaTracks } from "../src/Foundation/Media/RemoteMediaTracks";
import { RemoteMediaFrameController } from "../src/Render/Video/RemoteMediaFrameController";

const state = vi.hoisted(() => ({ audio: [] as any[], video: [] as any[], prepare: vi.fn(async (_signal: AbortSignal) => {}) }));
vi.mock("../src/Foundation/Media/Audio/RemoteAudioFrameSource", () => ({
  RemoteAudioFrameSource: class {
    prepare = state.prepare;
    setTrack = vi.fn((_track: unknown, _listener: (packet: any) => void) => {});
    close = vi.fn(async () => {});
    constructor() { state.audio.push(this); }
  },
}));
vi.mock("../src/Foundation/Media/Video/RemoteVideoFrameSource", () => ({
  RemoteVideoFrameSource: class {
    start = vi.fn((_track: unknown, _listener: (packet: any) => void) => {});
    stop = vi.fn();
    constructor() { state.video.push(this); }
  },
}));

function tracks(bindingID = "task"): RemoteMediaTracks {
  return { bindingID, userID: "bot", videoTrack: { kind: "video" } as MediaStreamTrack };
}

function frame(timestamp = 5_000_000) {
  return { timestamp, duration: 33_333, displayWidth: 320, displayHeight: 180, close: vi.fn() };
}

describe("RemoteMediaFrameController", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    state.audio.length = state.video.length = 0;
    state.prepare.mockReset().mockResolvedValue();
    vi.stubGlobal("VideoFrame", class {});
    vi.stubGlobal("HTMLVideoElement", class { requestVideoFrameCallback() {} });
  });
  afterEach(() => { vi.useRealTimers(); vi.unstubAllGlobals(); vi.restoreAllMocks(); });

  it("allocates no audio graph or video observation without a listener", () => {
    const controller = new RemoteMediaFrameController();
    controller.setSource(tracks());
    controller.setSource(undefined);
    expect(state.audio).toHaveLength(0);
    expect(state.video[0].start).not.toHaveBeenCalled();
    expect(vi.getTimerCount()).toBe(0);
  });

  it("shares a stream identity and clock, supports late audio, and passes owned raw video", async () => {
    const controller = new RemoteMediaFrameController();
    const listener = vi.fn(), source = tracks();
    controller.setSource(source);
    await controller.setListener(listener);
    const video = frame();
    state.video[0].start.mock.calls[0][1]({ frame: video, discontinuous: true });
    const audioTrack = { kind: "audio" } as MediaStreamTrack;
    controller.setSource({ ...source, audioTrack });
    const emitAudio = state.audio[0].setTrack.mock.calls.at(-1)[1];
    emitAudio({ data: new Uint8Array(1920), sampleRate: 48000, channels: 1, samplesPerChannel: 960,
      presentationTimeStamp: 4_980_000, discontinuous: true });
    await vi.runAllTimersAsync();
    expect(listener.mock.calls[0]![0].streamID).toBe(listener.mock.calls[1]![0].streamID);
    expect(listener.mock.calls.map(call => call[0].presentationTimeStamp)).toEqual([5_000_000, 4_980_000]);
    expect(listener.mock.calls[0]![0].content.frame.frame).toBe(video);
    expect(listener.mock.calls[1]![0].duration).toBe(20_000);
    expect(video.close).not.toHaveBeenCalled();
    expect(state.video[0].start).toHaveBeenCalledOnce();
    await controller.setListener(undefined);
    expect(state.audio[0].close).toHaveBeenCalledOnce();
  });

  it("rejects stale video across replacement tasks and clears queued media on removal", async () => {
    const controller = new RemoteMediaFrameController();
    const listener = vi.fn(), source = tracks();
    await controller.setListener(listener);
    controller.setSource(source);
    const oldVideo = state.video[0].start.mock.calls[0][1];
    oldVideo({ frame: frame(), discontinuous: false });
    await vi.runAllTimersAsync();
    const firstID = listener.mock.calls[0]![0].streamID;
    controller.setSource({ ...source, bindingID: "next-task" });
    const stale = frame();
    oldVideo({ frame: stale, discontinuous: false });
    expect(stale.close).toHaveBeenCalledOnce();
    state.video[0].start.mock.calls[1][1]({ frame: frame(), discontinuous: false });
    await vi.runAllTimersAsync();
    expect(listener.mock.calls[1]![0].streamID).not.toBe(firstID);
    expect(listener.mock.calls[1]![0].isDiscontinuous).toBe(true);
    const pending = frame();
    state.video[0].start.mock.calls[1][1]({ frame: pending, discontinuous: false });
    await controller.setListener(undefined);
    expect(pending.close).toHaveBeenCalledOnce();
    expect(vi.getTimerCount()).toBe(0);
    expect(listener).toHaveBeenCalledTimes(2);
  });

  it("does not let replaced initialization install a stale listener or close a new context", async () => {
    const controller = new RemoteMediaFrameController();
    let ready!: () => void;
    state.prepare.mockImplementationOnce(() => new Promise<void>(resolve => { ready = resolve; }));
    const old = controller.setListener(vi.fn());
    await Promise.resolve();
    const rejected = expect(old).rejects.toMatchObject({ code: "CANCELLED" });
    await controller.setListener(vi.fn());
    ready();
    await rejected;
    expect(state.audio[1].close).not.toHaveBeenCalled();
    await controller.setListener(undefined);
    expect(state.audio[1].close).toHaveBeenCalledOnce();
  });

  it("explicitly rejects missing browser capabilities without starting a graph", async () => {
    vi.stubGlobal("VideoFrame", undefined);
    const controller = new RemoteMediaFrameController();
    await expect(controller.setListener(vi.fn())).rejects.toThrow("cannot provide remote video");
    expect(state.audio).toHaveLength(0);
    await controller.setListener(undefined);
  });
});
