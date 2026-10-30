import { afterEach, describe, expect, it, vi } from "vitest";
import type { IAgoraRTC } from "agora-rtc-sdk-ng";
import type { IBeautyExtension, IBeautyProcessor } from "agora-extension-beauty-effect";
import { AgoraBeautyController } from "../src/Render/Beauty/AgoraBeautyController";

function setup() {
  let destination: Parameters<IBeautyProcessor["pipe"]>[0] | undefined;
  const clone = { stop: vi.fn() } as unknown as MediaStreamTrack;
  const input = { clone: vi.fn(() => clone), stop: vi.fn() } as unknown as MediaStreamTrack;
  const output = { stop: vi.fn() } as unknown as MediaStreamTrack;
  const processor = {
    setOptions: vi.fn(),
    enable: vi.fn(async () => {}),
    release: vi.fn(async () => {}),
    unpipe: vi.fn(),
    onoverload: undefined as (() => void) | undefined,
    pipe: vi.fn((next: typeof destination) => { destination = next; return next; }),
  };
  const wrapper = {
    pipe: vi.fn(() => processor),
    unpipe: vi.fn(),
    close: vi.fn(() => clone.stop()),
  };
  const sdk = { createCustomVideoTrack: vi.fn(() => wrapper) };
  const extension = { createProcessor: vi.fn(() => processor) };
  const runtime = { sdk: sdk as unknown as IAgoraRTC, extension: extension as unknown as IBeautyExtension };
  const load = vi.fn(async () => runtime);
  const onOutput = vi.fn();
  const onError = vi.fn();
  const controller = new AgoraBeautyController(onOutput, onError, load);
  return {
    controller, input, clone, output, processor, wrapper, sdk, onOutput, onError, load, runtime,
    emit: (track = output) => destination?.updateInput({ track } as Parameters<NonNullable<typeof destination>["updateInput"]>[0]),
  };
}

afterEach(() => {
  vi.useRealTimers();
});

describe("result beauty processing", () => {
  it("processes an unpublished clone and releases owned tracks without stopping the received video", async () => {
    const s = setup();
    const starting = s.controller.start(s.input, { smoothness: 0.4 });
    await vi.waitFor(() => expect(s.processor.enable).toHaveBeenCalledOnce());
    s.emit(s.clone);
    expect(s.onOutput).not.toHaveBeenCalled();
    s.emit();
    await starting;
    expect(s.sdk.createCustomVideoTrack).toHaveBeenCalledWith({ mediaStreamTrack: s.clone });
    expect(s.onOutput).toHaveBeenCalledWith(s.output);
    expect(s.processor.setOptions).toHaveBeenLastCalledWith({
      lighteningContrastLevel: 1, lighteningLevel: 0.2, smoothnessLevel: 0.4, sharpnessLevel: 0.2, rednessLevel: 0.1,
    });
    s.controller.update({ smoothness: 0.7 });
    expect(s.processor.setOptions).toHaveBeenLastCalledWith(expect.objectContaining({ smoothnessLevel: 0.7 }));
    await s.controller.dispose();
    expect(s.wrapper.close).toHaveBeenCalledOnce();
    expect(s.processor.release).toHaveBeenCalledOnce();
    expect(s.output.stop).toHaveBeenCalled();
    expect(s.input.stop).not.toHaveBeenCalled();
    await s.controller.dispose();
    expect(s.processor.release).toHaveBeenCalledOnce();
  });

  it("does not create tracks after being disabled during lazy loading", async () => {
    const s = setup();
    let resolve!: (value: typeof s.runtime) => void;
    s.load.mockReturnValueOnce(new Promise(yes => { resolve = yes; }));
    const starting = s.controller.start(s.input, {});
    await s.controller.dispose();
    resolve(s.runtime);
    await starting;
    expect(s.sdk.createCustomVideoTrack).not.toHaveBeenCalled();
    expect(s.input.clone).not.toHaveBeenCalled();
  });

  it("releases the worker and owned tracks even when unpiping fails", async () => {
    const s = setup();
    const starting = s.controller.start(s.input, {});
    await vi.waitFor(() => expect(s.processor.enable).toHaveBeenCalledOnce());
    s.emit();
    await starting;
    s.wrapper.unpipe.mockImplementation(() => { throw new Error("Unpipe failed"); });
    await expect(s.controller.dispose()).rejects.toThrow("Unpipe failed");
    expect(s.wrapper.close).toHaveBeenCalledOnce();
    expect(s.output.stop).toHaveBeenCalled();
    expect(s.processor.release).toHaveBeenCalledOnce();
    expect(s.input.stop).not.toHaveBeenCalled();
  });

  it("keeps the latest strengths changed while loading", async () => {
    const s = setup();
    let resolve!: (value: typeof s.runtime) => void;
    s.load.mockReturnValueOnce(new Promise(yes => { resolve = yes; }));
    const starting = s.controller.start(s.input, { smoothness: 0.1 });
    s.controller.update({ smoothness: 0.8 });
    resolve(s.runtime);
    await vi.waitFor(() => expect(s.processor.enable).toHaveBeenCalledOnce());
    s.emit();
    await starting;
    expect(s.processor.setOptions).toHaveBeenLastCalledWith(expect.objectContaining({ smoothnessLevel: 0.8 }));
    await s.controller.dispose();
  });

  it("rejects first-output timeout while retaining the original input", async () => {
    vi.useFakeTimers();
    const s = setup();
    const starting = s.controller.start(s.input, {});
    const rejected = expect(starting).rejects.toMatchObject({ code: "TIMEOUT" });
    await vi.advanceTimersByTimeAsync(5000);
    await rejected;
    await s.controller.dispose();
    expect(s.input.stop).not.toHaveBeenCalled();
  });

  it("cancels pending output and discards late processed tracks", async () => {
    const s = setup();
    const starting = s.controller.start(s.input, {});
    const rejected = expect(starting).rejects.toMatchObject({ code: "CANCELLED" });
    await vi.waitFor(() => expect(s.processor.enable).toHaveBeenCalledOnce());
    await s.controller.dispose();
    await rejected;
    s.emit();
    expect(s.onOutput).not.toHaveBeenCalled();
    expect(s.output.stop).toHaveBeenCalled();
    expect(s.input.stop).not.toHaveBeenCalled();
  });

  it("reports processing overload separately from the original stream", async () => {
    const s = setup();
    const starting = s.controller.start(s.input, {});
    await vi.waitFor(() => expect(s.processor.enable).toHaveBeenCalledOnce());
    s.emit();
    await starting;
    s.processor.onoverload?.();
    expect(s.onError).toHaveBeenCalledWith(expect.objectContaining({ code: "MEDIA_ERROR" }));
    expect(s.input.stop).not.toHaveBeenCalled();
    await s.controller.dispose();
  });

  it.each([-1, 1.1, NaN, Infinity])("rejects invalid strengths before loading the extension: %s", async smoothness => {
    const s = setup();
    await expect(s.controller.start(s.input, { smoothness })).rejects.toMatchObject({ code: "INVALID_CONFIGURATION" });
    expect(s.load).not.toHaveBeenCalled();
    expect(s.input.clone).not.toHaveBeenCalled();
  });
});
