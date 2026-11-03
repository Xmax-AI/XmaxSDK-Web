import { afterEach, describe, expect, it, vi } from "vitest";
import { StableVideoOutput } from "../src/Render/Video/StableVideoOutput";

function setup(manualFrames = true) {
  const output = { kind: "video", stop: vi.fn(), ...(manualFrames ? { requestFrame: vi.fn() } : {}) };
  const callbacks = new Map<number, () => void>();
  let sequence = 0;
  const video = {
    style: {}, muted: false, playsInline: false, readyState: 4, videoWidth: 640, videoHeight: 360, currentTime: 0,
    srcObject: null as unknown, onerror: undefined as unknown, setAttribute: vi.fn(), pause: vi.fn(), remove: vi.fn(),
    play: vi.fn(async () => {}),
    requestVideoFrameCallback: vi.fn((callback: () => void) => { callbacks.set(++sequence, callback); return sequence; }),
    cancelVideoFrameCallback: vi.fn((id: number) => callbacks.delete(id)),
  };
  const context = { drawImage: vi.fn() };
  const stream = { getVideoTracks: () => [output], getTracks: () => [output] };
  const canvas = { width: 0, height: 0, getContext: vi.fn(() => context), captureStream: vi.fn(() => stream) };
  vi.stubGlobal("document", {
    createElement: (tag: string) => tag === "video" ? video : canvas,
    body: { appendChild: vi.fn() },
  });
  vi.stubGlobal("MediaStream", class { constructor(readonly tracks: unknown[]) {} });
  const emit = vi.fn(), error = vi.fn();
  const bridge = new StableVideoOutput(emit, error);
  const input = { stop: vi.fn() } as unknown as MediaStreamTrack;
  const tick = () => {
    video.currentTime += 1 / 30;
    const [id, callback] = [...callbacks.entries()].at(-1)!;
    callbacks.delete(id);
    callback();
  };
  return { bridge, input, video, canvas, context, output, emit, error, tick, callbacks };
}

afterEach(() => { vi.unstubAllGlobals(); vi.useRealTimers(); });

describe("stable browser result output", () => {
  it("retains output across beauty source and natural dimension changes without stopping inputs", async () => {
    const s = setup();
    s.bridge.setSource(s.input);
    await Promise.resolve();
    expect(s.emit).toHaveBeenCalledOnce();
    expect(s.emit).toHaveBeenCalledWith(s.output);
    const processed = { stop: vi.fn() } as unknown as MediaStreamTrack;
    s.bridge.setSource(processed);
    s.video.videoWidth = 1080;
    s.video.videoHeight = 1920;
    await Promise.resolve();
    s.tick();
    expect(s.canvas.width).toBe(1080);
    expect(s.canvas.height).toBe(1920);
    expect(s.canvas.captureStream).toHaveBeenCalledOnce();
    expect(s.emit).toHaveBeenCalledOnce();
    s.bridge.setSource(s.input);
    await Promise.resolve();
    expect(s.emit).toHaveBeenCalledOnce();
    expect(s.input.stop).not.toHaveBeenCalled();
    expect(processed.stop).not.toHaveBeenCalled();
    s.bridge.dispose();
    expect(s.output.stop).toHaveBeenCalledOnce();
    expect(s.callbacks.size).toBe(0);
    expect(s.video.remove).toHaveBeenCalledOnce();
  });

  it("uses automatic canvas capture when requestFrame is unavailable", async () => {
    const s = setup(false);
    s.bridge.setSource(s.input);
    await Promise.resolve();
    expect(s.canvas.captureStream.mock.calls).toEqual([[0], [60]]);
    expect(s.emit).toHaveBeenCalledOnce();
    s.bridge.dispose();
  });

  it("does not start callbacks after being disposed during play initialization", async () => {
    const s = setup();
    let resume!: () => void;
    s.video.play.mockImplementation(() => new Promise(resolve => { resume = resolve; }));
    s.bridge.setSource(s.input);
    s.bridge.dispose();
    resume();
    await Promise.resolve();
    expect(s.canvas.captureStream).not.toHaveBeenCalled();
    expect(s.video.requestVideoFrameCallback).not.toHaveBeenCalled();
    expect(s.input.stop).not.toHaveBeenCalled();
  });

  it("bounds a missing first frame and cancels the deadline on cleanup", async () => {
    vi.useFakeTimers();
    const s = setup();
    s.video.readyState = 0;
    s.bridge.setSource(s.input);
    await vi.advanceTimersByTimeAsync(5000);
    expect(s.error).toHaveBeenCalledWith(expect.objectContaining({ code: "TIMEOUT" }));
    s.bridge.dispose();
    expect(vi.getTimerCount()).toBe(0);
  });
});
