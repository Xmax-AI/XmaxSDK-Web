import { describe, expect, it, vi } from "vitest";
import { runInNewContext } from "node:vm";
import { REMOTE_AUDIO_WORKLET } from "../src/Foundation/Media/Audio/RemoteAudioWorklet";

function setup() {
  const packets: Array<{ data: ArrayBuffer; sampleRate: number; channels: number; samplesPerChannel: number; frameIndex: number; discontinuous: boolean }> = [];
  let Processor!: new () => { process(inputs: Float32Array[][]): boolean };
  const context = {
    sampleRate: 48000, currentFrame: 0, ArrayBuffer, DataView,
    AudioWorkletProcessor: class { port = { postMessage: vi.fn(packet => packets.push(packet)) }; },
    registerProcessor: (name: string, value: typeof Processor) => {
      expect(name).toBe("xmax-remote-audio");
      Processor = value;
    },
  };
  runInNewContext(REMOTE_AUDIO_WORKLET, context);
  const processor = new Processor();
  const push = (channels: number[][] = [[0.5]], length = 128) => {
    const input = channels.map(pattern => Float32Array.from({ length }, (_, index) => pattern[index % pattern.length]!));
    expect(processor.process([input])).toBe(true);
    context.currentFrame += length;
  };
  return { context, packets, push, processor };
}

describe("remote PCM worklet", () => {
  it("aggregates 128-sample render quanta into exact sample-clock packets", () => {
    const s = setup();
    for (let index = 0; index < 16; index++) s.push();
    expect(s.packets).toHaveLength(2);
    expect(s.packets.map(packet => packet.frameIndex)).toEqual([0, 960]);
    expect(s.packets.map(packet => packet.discontinuous)).toEqual([true, false]);
    expect(s.packets[0]).toMatchObject({ sampleRate: 48000, channels: 1, samplesPerChannel: 960 });
    expect(s.packets[0]!.data.byteLength).toBe(960 * 2);
  });

  it("produces owned little-endian, interleaved S16 PCM with clipping", () => {
    const s = setup();
    for (let index = 0; index < 8; index++) s.push([[-2, -1, 0, 0.5, 1, 2], [1, 0, -1, -0.5, 0, 0.25]]);
    const bytes = new DataView(s.packets[0]!.data);
    expect(Array.from({ length: 12 }, (_, index) => bytes.getInt16(index * 2, true))).toEqual([
      -32768, 32767, -32768, 0, 0, -32768, 16384, -16384, 32767, 0, 32767, 8192,
    ]);
    expect(s.packets[0]!.channels).toBe(2);
  });

  it("does not manufacture audio without an input and marks recovery discontinuous", () => {
    const s = setup();
    s.processor.process([[]]);
    expect(s.packets).toHaveLength(0);
    for (let index = 0; index < 8; index++) s.push();
    s.processor.process([[]]);
    for (let index = 0; index < 8; index++) s.push();
    expect(s.packets.map(packet => packet.discontinuous)).toEqual([true, true]);
    expect(s.packets[1]!.frameIndex).toBe(1024);
  });

  it("drops partial packets and exposes clock gaps and channel changes", () => {
    const s = setup();
    s.push();
    s.context.currentFrame = 48000;
    for (let index = 0; index < 8; index++) s.push();
    for (let index = 0; index < 8; index++) s.push([[0], [1]]);
    expect(s.packets.map(packet => [packet.frameIndex, packet.channels, packet.discontinuous])).toEqual([
      [48000, 1, true], [49024, 2, true],
    ]);
  });
});
