import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { RecordingVideoFrameConverter } from "../src/recording/RecordingVideoFrameConverter";

class CopiedFrame {
  readonly bytes: Uint8Array;
  close = vi.fn();
  constructor(data: Uint8Array, readonly init: VideoFrameBufferInit) { this.bytes = data.slice(); }
}

function decodedFrame(format: VideoPixelFormat | null = "NV12") {
  return {
    format, visibleRect: { x: 0, y: 0, width: 320, height: 180 },
    codedWidth: 320, codedHeight: 192, displayWidth: 320, displayHeight: 180,
    colorSpace: { toJSON: () => ({ primaries: "bt709", transfer: "bt709", matrix: "bt709", fullRange: false }) },
    allocationSize: vi.fn(() => 320 * 180 * 1.5),
    copyTo: vi.fn(async (data: Uint8Array) => {
      data.fill(128);
      return [{ offset: 0, stride: 320 }, { offset: 320 * 180, stride: 320 }];
    }),
    close: vi.fn(),
  };
}

describe("recording video input compatibility", () => {
  let context: { drawImage: ReturnType<typeof vi.fn>; getImageData: ReturnType<typeof vi.fn> };
  const canvases: Array<{ width: number; height: number }> = [];
  beforeEach(() => {
    canvases.length = 0;
    context = { drawImage: vi.fn(), getImageData: vi.fn((_x, _y, width, height) => ({ data: new Uint8Array(width * height * 4) })) };
    vi.stubGlobal("VideoFrame", CopiedFrame);
    vi.stubGlobal("OffscreenCanvas", class {
      constructor(public width: number, public height: number) { canvases.push(this); }
      getContext() { return context; }
    });
  });
  afterEach(() => vi.unstubAllGlobals());

  it.each(["NV12", "I420", "RGBA"] as const)("copies %s decoder surfaces to CPU memory without altering the source", async format => {
    const converter = new RecordingVideoFrameConverter();
    const original = decodedFrame(format);
    const result = await converter.convert(original as unknown as VideoFrame, 123_456, 33_333) as unknown as CopiedFrame;
    expect(result).not.toBe(original);
    expect(result.bytes[0]).toBe(128);
    expect(result.init).toMatchObject({ format, codedWidth: 320, codedHeight: 180, displayWidth: 320,
      displayHeight: 180, timestamp: 123_456, duration: 33_333 });
    expect(result.init.layout).toHaveLength(2);
    expect(result.init.colorSpace).toEqual(original.colorSpace.toJSON());
    expect(original.close).not.toHaveBeenCalled();
    expect(canvases).toHaveLength(0);
  });

  it("reuses scratch memory while each output owns its own bytes", async () => {
    const converter = new RecordingVideoFrameConverter();
    const original = decodedFrame();
    const first = await converter.convert(original as unknown as VideoFrame, 0, 33_333) as unknown as CopiedFrame;
    original.copyTo.mockImplementation(async data => { data.fill(64); return []; });
    const second = await converter.convert(original as unknown as VideoFrame, 33_333, 33_333) as unknown as CopiedFrame;
    expect(original.copyTo.mock.calls[0]![0]).toBe(original.copyTo.mock.calls[1]![0]);
    expect(first.bytes[0]).toBe(128);
    expect(second.bytes[0]).toBe(64);
  });

  it("reads opaque surfaces back as CPU RGBA, rather than passing another GPU surface to the encoder", async () => {
    const converter = new RecordingVideoFrameConverter();
    const original = decodedFrame(null);
    const result = await converter.convert(original as unknown as VideoFrame, 50_000, 33_333) as unknown as CopiedFrame;
    expect(original.copyTo).not.toHaveBeenCalled();
    expect(context.drawImage).toHaveBeenCalledWith(original, 0, 0, 320, 180);
    expect(context.getImageData).toHaveBeenCalledWith(0, 0, 320, 180);
    expect(result.init).toMatchObject({ format: "RGBA", timestamp: 50_000, codedWidth: 320, codedHeight: 180 });
    expect(result.bytes.byteLength).toBe(320 * 180 * 4);
  });

  it("falls back when native readback is unavailable, reusing the canvas across later frames and resize", async () => {
    const converter = new RecordingVideoFrameConverter();
    const original = decodedFrame();
    original.copyTo.mockRejectedValue(new Error("GPU surface cannot be mapped"));
    await converter.convert(original as unknown as VideoFrame, 0, 33_333);
    original.displayWidth = 640;
    original.displayHeight = 360;
    await converter.convert(original as unknown as VideoFrame, 33_333, 33_333);
    expect(original.copyTo).toHaveBeenCalledOnce();
    expect(canvases).toHaveLength(1);
    expect(canvases[0]).toMatchObject({ width: 640, height: 360 });
    expect(context.getImageData).toHaveBeenLastCalledWith(0, 0, 640, 360);
  });

  it("reports failed fallback conversion without taking ownership of the SDK frame", async () => {
    const original = decodedFrame(null);
    context.drawImage.mockImplementation(() => { throw new Error("context lost"); });
    await expect(new RecordingVideoFrameConverter().convert(original as unknown as VideoFrame, 0, 1)).rejects.toThrow("context lost");
    expect(original.close).not.toHaveBeenCalled();
  });
});
