import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ExternalAudioFrameSource } from "../src/Foundation/Media/Audio/ExternalAudioFrameSource";
import type { RealtimeExternalAudioFrame as AudioData } from "../src/Foundation/Media/Audio/RealtimeExternalAudioFrame";

function setup() {
  const contexts: Context[] = [];
  const processors: Processor[] = [];
  const load = vi.fn(async () => {});
  const resume = vi.fn(async () => {});
  class Processor {
    port = { onmessage: null as any, postMessage: vi.fn(), close: vi.fn() };
    connect = vi.fn();
    disconnect = vi.fn();
    onprocessorerror: (() => void) | null = null;
    constructor() { processors.push(this); }
  }
  class Context {
    currentTime = 0;
    sampleRate = 48000;
    state = "running";
    destination = { speaker: true };
    track = Object.assign(new EventTarget(), { readyState: "live", stop: vi.fn() });
    mediaDestination = { channelCount: 2, channelCountMode: "max", disconnect: vi.fn(),
      stream: { getAudioTracks: () => [this.track], getTracks: () => [this.track] } };
    audioWorklet = { addModule: load };
    resume = resume;
    close = vi.fn(async () => { this.state = "closed"; });
    createMediaStreamDestination() { return this.mediaDestination; }
    constructor() { contexts.push(this); }
  }
  vi.stubGlobal("AudioContext", Context);
  vi.stubGlobal("AudioWorkletNode", Processor);
  vi.stubGlobal("MediaStreamAudioDestinationNode", class {
    constructor(context: Context, options: object) { return Object.assign(context.mediaDestination, options); }
  });
  vi.spyOn(URL, "createObjectURL").mockReturnValue("blob:audio");
  vi.spyOn(URL, "revokeObjectURL").mockImplementation(() => {});
  const source = new ExternalAudioFrameSource();
  const error = vi.fn();
  const prepare = () => source.prepare(new AbortController().signal, error);
  const frame = (timestamp = 0, options: Record<string, unknown> = {}) => ({
    timestamp, sampleRate: 48000, numberOfChannels: 2, numberOfFrames: 480, format: "f32-planar",
    copyTo: vi.fn((destination: Float32Array, { planeIndex }: { planeIndex: number }) => destination.fill(planeIndex ? 1 : 0)),
    close: vi.fn(), ...options,
  } as unknown as AudioData & { close: ReturnType<typeof vi.fn> });
  return { source, error, frame, prepare, contexts, processors, load, resume };
}

describe("external PCM to RTC track", () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => { vi.useRealTimers(); vi.unstubAllGlobals(); vi.restoreAllMocks(); });

  it("creates mono output without a microphone or speaker connection and only copies published input", async () => {
    const s = setup();
    await s.prepare();
    const context = s.contexts[0]!, processor = s.processors[0]!;
    expect(s.source.track).toBe(context.track);
    expect(context.mediaDestination.channelCount).toBe(1);
    expect(processor.connect).toHaveBeenCalledWith(context.mediaDestination);
    expect(processor.connect).not.toHaveBeenCalledWith(context.destination);
    const input = s.frame();
    s.source.push(input, () => 20_000);
    expect(input.copyTo).not.toHaveBeenCalled();
    s.source.setPublished(true);
    const next = s.frame(10_000);
    s.source.push(next, () => 20_000);
    const packet = processor.port.postMessage.mock.calls.at(-1)![0];
    expect(packet).toMatchObject({ type: "packet", rate: 48000, start: 960, end: 1440 });
    expect([...packet.samples].every(value => value === 0.5)).toBe(true);
    expect(next.close).not.toHaveBeenCalled();
    s.source.setPublished(false);
    expect(processor.port.postMessage).toHaveBeenLastCalledWith(expect.objectContaining({ type: "reset" }));
    await s.source.close();
    expect(context.track.stop).toHaveBeenCalledOnce();
    expect(context.close).toHaveBeenCalledOnce();
    expect(URL.revokeObjectURL).toHaveBeenCalledWith("blob:audio");
  });

  it("ignores invalid timestamps and overlaps, retains gaps, and rejects a changing PCM format", async () => {
    const s = setup();
    await s.prepare();
    s.source.setPublished(true);
    const map = vi.fn(time => time + 20_000);
    s.source.push(s.frame(-1), map);
    s.source.push(s.frame(0), map);
    s.source.push(s.frame(0), map);
    s.source.push(s.frame(5000), map);
    s.source.push(s.frame(100_000), map);
    expect(map.mock.calls.map(call => call[0])).toEqual([0, 100_000]);
    expect(() => s.source.push(s.frame(200_000, { sampleRate: 44100 }), map)).toThrow("remain unchanged");
    await s.source.close();
  });

  it("bounds queued data and ignores stale acknowledgements after a reset", async () => {
    const s = setup();
    await s.prepare();
    s.source.setPublished(true);
    const processor = s.processors[0]!;
    for (let index = 0; index < 2; index++) s.source.push(s.frame(index * 1_000_000, { numberOfFrames: 48000 }), time => time);
    expect(() => s.source.push(s.frame(2_000_000), time => time)).toThrow("pending audio");
    const staleEpoch = processor.port.postMessage.mock.calls.find(call => call[0].type === "packet")![0].epoch;
    s.source.reset();
    processor.port.onmessage({ data: { id: 1, epoch: staleEpoch } });
    s.contexts[0]!.currentTime = 3;
    expect(() => s.source.push(s.frame(3_000_000), time => time)).not.toThrow();
    await s.source.close();
  });

  it("reports track and processor failures, but not intentionally stopped output", async () => {
    const s = setup();
    await s.prepare();
    const context = s.contexts[0]!, processor = s.processors[0]!;
    context.track.dispatchEvent(new Event("ended"));
    expect(s.error).toHaveBeenLastCalledWith(expect.objectContaining({ message: "External audio output ended" }));
    processor.onprocessorerror!();
    expect(s.error).toHaveBeenLastCalledWith(expect.objectContaining({ message: "External audio processor failed" }));
    await s.source.close();
    context.track.dispatchEvent(new Event("ended"));
    expect(s.error).toHaveBeenCalledTimes(2);
    expect(processor.onprocessorerror).toBeNull();
  });

  it("rejects suspended audio instead of accumulating input", async () => {
    const s = setup();
    await s.prepare();
    s.source.setPublished(true);
    s.contexts[0]!.state = "suspended";
    const input = s.frame();
    expect(() => s.source.push(input, time => time)).toThrow("suspended");
    expect(input.copyTo).not.toHaveBeenCalled();
    await s.source.close();
  });

  it.each(["failure", "cancel", "timeout"])("cleans up failed preparation: %s", async mode => {
    const s = setup(), abort = new AbortController();
    if (mode === "failure") s.load.mockRejectedValueOnce(new Error("CSP blocked"));
    else s.resume.mockReturnValueOnce(new Promise(() => {}));
    const pending = s.source.prepare(abort.signal, s.error);
    const rejected = expect(pending).rejects.toThrow(mode === "failure" ? "CSP blocked" : mode === "cancel" ? "cancelled" : "timed out");
    if (mode === "cancel") abort.abort();
    if (mode === "timeout") await vi.advanceTimersByTimeAsync(3000);
    await rejected;
    expect(s.contexts[0]!.close).toHaveBeenCalledOnce();
    expect(vi.getTimerCount()).toBe(0);
  });
});
