import { afterEach, describe, expect, it, vi } from "vitest";
import { CameraRotationProcessor } from "../src/Foundation/Media/Camera/CameraRotationProcessor";
import { validateCameraRotation } from "../src/Foundation/Media/Camera/CameraRotation";
import { cameraRotationEnvironment } from "./helpers/CameraRotationEnvironment";

const processors: CameraRotationProcessor[] = [];
function setup(rotation: 90 | 180 | 270 = 90, mirrored = false) {
  const env = cameraRotationEnvironment();
  const onError = vi.fn();
  const processor = new CameraRotationProcessor({ width: 1024, height: 1920, frameRate: 30, rotation, mirrored, onError });
  processors.push(processor);
  return { ...env, processor, onError };
}
afterEach(() => {
  processors.splice(0).forEach(processor => processor.stop());
  vi.unstubAllGlobals();
  vi.useRealTimers();
});

describe("CameraRotationProcessor", () => {
  it("resizes the rotation output without recreating its stream or output track", async () => {
    const s = setup();
    const started = s.processor.setSource(s.source);
    await Promise.resolve(); s.frame(); await started;
    await s.processor.updateFormat(1408, 1408, 24);
    expect(s.canvas.width).toBe(1408);
    expect(s.canvas.height).toBe(1408);
    expect(s.output.applyConstraints).toHaveBeenCalledWith({ frameRate: 24 });
    expect(s.canvas.captureStream).toHaveBeenCalledOnce();
    expect(s.output.stop).not.toHaveBeenCalled();
    expect(s.source.stop).not.toHaveBeenCalled();
    expect(s.output.requestFrame).toHaveBeenCalled();
  });

  it.each([90, 180, 270] as const)("rotates %s degrees clockwise and produces the target size only after a real frame", async rotation => {
    const s = setup(rotation);
    if (rotation === 180) { s.video.videoWidth = 1024; s.video.videoHeight = 1920; }
    const started = s.processor.setSource(s.source);
    await Promise.resolve();
    expect(s.canvas.captureStream).not.toHaveBeenCalled();
    s.frame();
    expect(await started).toBe(s.output);
    expect(s.canvas.width).toBe(1024);
    expect(s.canvas.height).toBe(1920);
    expect(s.context.setTransform).toHaveBeenCalledWith(1, 0, 0, 1, 512, 960);
    expect(s.context.rotate).toHaveBeenCalledWith(rotation * Math.PI / 180);
    expect(s.context.drawImage).toHaveBeenCalledWith(s.video, 0, 0, s.video.videoWidth, s.video.videoHeight,
      -s.video.videoWidth / 2, -s.video.videoHeight / 2, s.video.videoWidth, s.video.videoHeight);
    expect(s.output.requestFrame).toHaveBeenCalled();
    expect(s.video.muted && s.video.playsInline).toBe(true);
  });

  it("uses actual source dimensions with an aspect-preserving center crop", async () => {
    const s = setup();
    s.video.videoWidth = 640; s.video.videoHeight = 480;
    const started = s.processor.setSource(s.source);
    await Promise.resolve(); s.frame(); await started;
    const args = s.context.drawImage.mock.calls[0]!;
    expect(args[1]).toBe(0);
    expect(args[2]).toBeCloseTo((480 - 1024 / 3) / 2);
    expect(args[3]).toBe(640);
    expect(args[4]).toBeCloseTo(1024 / 3);
    expect(args.slice(5)).toEqual([-960, -512, 1920, 1024]);
  });

  it("mirrors across the final horizontal axis in the same draw as a quarter-turn rotation", async () => {
    const s = setup(90, true);
    const started = s.processor.setSource(s.source);
    await Promise.resolve(); s.frame(); await started;
    expect(s.context.setTransform).toHaveBeenCalledWith(-1, 0, 0, 1, 512, 960);
    expect(s.context.rotate).toHaveBeenCalledWith(Math.PI / 2);
    expect(s.context.setTransform.mock.invocationCallOrder[0]).toBeLessThan(s.context.rotate.mock.invocationCallOrder[0]!);
    expect(s.context.drawImage).toHaveBeenCalledOnce();
  });

  it("waits for valid pixels instead of publishing an empty canvas", async () => {
    const s = setup();
    s.video.readyState = 1;
    const started = s.processor.setSource(s.source);
    await Promise.resolve(); s.frame();
    expect(s.canvas.captureStream).not.toHaveBeenCalled();
    s.video.readyState = 2; s.frame();
    expect(await started).toBe(s.output);
  });

  it("reuses the output and detaches the previous source when replacing it", async () => {
    const s = setup();
    const started = s.processor.setSource(s.source);
    await Promise.resolve(); s.frame(); await started;
    const replacement = new EventTarget() as MediaStreamTrack;
    const switched = s.processor.setSource(replacement);
    s.source.dispatchEvent(new Event("ended"));
    expect(s.onError).not.toHaveBeenCalled();
    await Promise.resolve(); s.frame();
    expect(await switched).toBe(s.output);
    expect(s.canvas.captureStream).toHaveBeenCalledOnce();
    expect(s.output.stop).not.toHaveBeenCalled();
    replacement.dispatchEvent(new Event("ended"));
    expect(s.output.stop).toHaveBeenCalledOnce();
    expect(s.onError).toHaveBeenCalledOnce();
    expect(s.callbacks.size).toBe(0);
  });

  it("does not revive a stopped processor when play finishes late", async () => {
    const s = setup();
    let resolvePlay!: () => void;
    s.video.play.mockReturnValue(new Promise<void>(resolve => { resolvePlay = resolve; }));
    const started = s.processor.setSource(s.source);
    const rejected = expect(started).rejects.toMatchObject({ code: "CANCELLED" });
    s.processor.stop(); resolvePlay(); await rejected;
    expect(s.callbacks.size).toBe(0);
    expect(s.canvas.captureStream).not.toHaveBeenCalled();
    expect(s.video.srcObject).toBeNull();
    expect(s.source.stop).not.toHaveBeenCalled();
  });

  it("retries aborted playback on the same camera stream and draws the first frame", async () => {
    const s = setup();
    s.video.play.mockRejectedValueOnce(new DOMException("The operation was aborted.", "AbortError"));
    const started = s.processor.setSource(s.source);
    const attachedStream = s.video.srcObject;

    await vi.waitFor(() => expect(s.callbacks.size).toBe(1));
    s.frame();
    expect(await started).toBe(s.output);
    expect(s.video.play).toHaveBeenCalledTimes(2);
    expect(s.video.srcObject).toBe(attachedStream);
    expect(s.source.stop).not.toHaveBeenCalled();
  });

  it("preserves the rejection after two playback aborts", async () => {
    const s = setup();
    const error = new DOMException("The operation was aborted.", "AbortError");
    s.video.play.mockRejectedValue(error);

    await expect(s.processor.setSource(s.source)).rejects.toMatchObject({ code: "INTERNAL_ERROR", message: error.message });
    expect(s.video.play).toHaveBeenCalledTimes(2);
  });

  it("does not retry aborted playback after stopping the processor", async () => {
    const s = setup();
    s.video.play.mockRejectedValueOnce(new DOMException("The operation was aborted.", "AbortError"));
    const rejected = expect(s.processor.setSource(s.source)).rejects.toMatchObject({ code: "CANCELLED" });
    s.processor.stop();
    await rejected;
    expect(s.video.play).toHaveBeenCalledOnce();
  });

  it("propagates other playback errors on the first attempt", async () => {
    const s = setup();
    const error = new DOMException("Playback was denied", "NotAllowedError");
    s.video.play.mockRejectedValueOnce(error);

    await expect(s.processor.setSource(s.source)).rejects.toMatchObject({ message: error.message });
    expect(s.video.play).toHaveBeenCalledOnce();
  });

  it("times out and releases scheduling resources if there are no frames", async () => {
    vi.useFakeTimers();
    const s = setup();
    const rejected = expect(s.processor.setSource(s.source)).rejects.toMatchObject({ code: "TIMEOUT" });
    await vi.advanceTimersByTimeAsync(10000); await rejected;
    expect(s.callbacks.size).toBe(0);
    expect(s.video.srcObject).toBeNull();
    expect(vi.getTimerCount()).toBe(0);
  });

  it("falls back to bounded timer drawing without requestVideoFrameCallback or requestFrame", async () => {
    vi.useFakeTimers();
    const s = setup();
    (s.video as any).requestVideoFrameCallback = undefined;
    (s.output as any).requestFrame = undefined;
    const started = s.processor.setSource(s.source);
    await vi.advanceTimersByTimeAsync(34);
    expect(await started).toBe(s.output);
    s.processor.stop();
    expect(vi.getTimerCount()).toBe(0);
  });

  it("reports draw failure and releases output instead of silently freezing", async () => {
    const s = setup();
    const started = s.processor.setSource(s.source);
    await Promise.resolve(); s.frame(); await started;
    s.context.drawImage.mockImplementation(() => { throw new Error("draw failed"); });
    s.frame();
    expect(s.onError).toHaveBeenCalledOnce();
    expect(s.output.stop).toHaveBeenCalledOnce();
    expect(s.callbacks.size).toBe(0);
  });

  it.each([-90, 45, 360, NaN])("rejects unsupported angle %s", angle => {
    expect(() => validateCameraRotation(angle)).toThrow("Camera rotation must be");
  });
});
