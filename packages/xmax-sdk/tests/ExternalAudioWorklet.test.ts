import { describe, expect, it, vi } from "vitest";
import { runInNewContext } from "node:vm";
import { EXTERNAL_AUDIO_WORKLET } from "../src/Foundation/Media/Audio/ExternalAudioWorklet";

function setup() {
  let Processor: any;
  const sent: unknown[] = [];
  const context = {
    sampleRate: 48000, currentFrame: 0,
    AudioWorkletProcessor: class { port = { onmessage: undefined as any, postMessage: vi.fn(message => sent.push(message)) }; },
    registerProcessor: (name: string, value: any) => { expect(name).toBe("xmax-external-audio"); Processor = value; },
  };
  runInNewContext(EXTERNAL_AUDIO_WORKLET, context);
  const processor = new Processor();
  const push = (samples: number[], start: number, rate = 48000, id = 1, epoch = 0) => {
    processor.port.onmessage({ data: { type: "packet", samples: Float32Array.from(samples), start,
      end: start + Math.round(samples.length / rate * 48000), rate, id, epoch } });
  };
  const render = (length: number) => {
    const output = new Float32Array(length);
    expect(processor.process([], [[output]])).toBe(true);
    context.currentFrame += length;
    return [...output];
  };
  return { processor, push, render, context, sent };
}

describe("external audio scheduling worklet", () => {
  it("schedules by sample time, retaining gaps as silence and returning consumed budgets", () => {
    const s = setup();
    s.push([0.25, 0.5], 2);
    s.push([1, 0.75], 6, 48000, 2);
    expect(s.render(9)).toEqual([0, 0, 0.25, 0.5, 0, 0, 1, 0.75, 0]);
    expect(s.sent).toEqual([{ id: 1, epoch: 0 }, { id: 2, epoch: 0 }]);
  });

  it("linearly resamples input instead of assuming the output sample rate", () => {
    const s = setup();
    s.push([0, 1, 0], 0, 24000);
    expect(s.render(7)).toEqual([0, 0.5, 1, 0.5, 0, 0, 0]);
    expect(s.sent).toHaveLength(1);
  });

  it("discards old epochs and disconnect queues without replaying them on reconnect", () => {
    const s = setup();
    s.push([1, 1], 2);
    s.processor.port.onmessage({ data: { type: "reset", epoch: 1 } });
    s.push([1, 1], 2, 48000, 2, 0);
    expect(s.render(8)).toEqual(Array(8).fill(0));
    s.push([0.5, 0.5], 8, 48000, 3, 1);
    expect(s.render(3)).toEqual([0.5, 0.5, 0]);
    expect(s.sent).toEqual([{ id: 3, epoch: 1 }]);
  });

  it("skips expired packets and the elapsed part of late packets", () => {
    const s = setup();
    s.context.currentFrame = 4;
    s.push([1, 1], 0);
    s.push([0, 0.25, 0.5, 0.75], 2, 48000, 2);
    expect(s.render(3)).toEqual([0.5, 0.75, 0]);
    expect(s.sent).toHaveLength(2);
  });
});
