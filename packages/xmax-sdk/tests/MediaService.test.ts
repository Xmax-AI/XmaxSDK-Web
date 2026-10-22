import { afterEach, describe, expect, it, vi } from "vitest";
import * as ModelDefinition from "../src/Service/Realtime/RealtimeModel";
import { defaultCameraVideoFormat, RealtimeModel } from "../src/Service/Realtime/RealtimeModel";
import { XmaxError, XmaxErrorCode } from "../src/Foundation/Errors/XmaxError";
import { MediaService } from "../src/Service/Media/MediaService";

describe("MediaService media, generation and target sizes", () => {
  const service = new MediaService();

  it.each(["image", "video", "external"] as const)("resolves %s metadata without forcing a model bucket or enlarging it", source => {
    expect(service.resolveMediaSize({ width: 1280, height: 720 }, source)).toEqual({ width: 1280, height: 720 });
    expect(service.resolveMediaSize({ width: 600, height: 600 }, source)).toEqual({ width: 600, height: 600 });
    expect(service.resolveMediaSize({ width: 3840, height: 2160 }, source)).toEqual({ width: 1920, height: 1080 });
    expect(service.resolveMediaSize({ width: 2160, height: 3840 }, source)).toEqual({ width: 1080, height: 1920 });
    expect(service.resolveMediaSize({ width: 1001, height: 1000 }, source)).toEqual({ width: 1000, height: 1000 });
  });

  it("retains camera bucket validation and chooses generation canvases independently", () => {
    expect(service.resolveMediaSize({ width: 1080, height: 1920 }, "camera")).toEqual({ width: 1080, height: 1920 });
    expect(() => service.resolveMediaSize({ width: 1280, height: 720 }, "camera")).toThrow("does not support input resolution");
    expect(service.resolveGenerationSize({ width: 1280, height: 720 })).toEqual({ width: 1920, height: 1080 });
    expect(service.resolveGenerationSize({ width: 720, height: 1280 })).toEqual({ width: 1080, height: 1920 });
    const square = service.resolveGenerationSize({ width: 600, height: 600 });
    expect(square).toEqual({ width: 1408, height: 1408 });
    square.width = 1;
    expect(ModelDefinition.resolutionBuckets(service.model)[2]!.width).toBe(1408);
  });

  it("resolves downlink bounds using the fixed media ratio and four-pixel alignment", () => {
    const media = { width: 1920, height: 1024 };
    expect(service.resolveTargetSize(media, { width: 1536, height: 819.2 })).toEqual({ width: 1500, height: 800 });
    expect(service.resolveTargetSize(media, { width: 1248, height: 665.6 })).toEqual({ width: 1200, height: 640 });
    expect(service.resolveTargetSize(media, media)).toEqual(media);
    expect(service.resolveTargetSize({ width: 1280, height: 720 }, { width: 1920, height: 1024 }))
      .toEqual({ width: 1280, height: 720 });
    expect(service.resolveTargetSize({ width: 1001, height: 1000 }, { width: 800, height: 800 }))
      .toEqual({ width: 800, height: 796 });
  });

  it.each([0, -1, 1.5, NaN, Infinity, Number.MAX_SAFE_INTEGER])("rejects invalid media width %s", width => {
    const size = { width, height: 1080 };
    expect(() => service.resolveMediaSize(size, "image")).toThrow(XmaxError);
    expect(() => service.resolveGenerationSize(size)).toThrow(XmaxError);
    expect(() => service.resolveTargetSize(size, { width: 640, height: 360 })).toThrow(XmaxError);
  });

  it("rejects impossible alignment and invalid target bounds", () => {
    expect(() => service.resolveMediaSize({ width: 1, height: 1 }, "video")).toThrow(XmaxError);
    for (const width of [0, -1, NaN, Infinity, 1]) {
      expect(() => service.resolveTargetSize({ width: 1280, height: 720 }, { width, height: 360 })).toThrow(XmaxError);
    }
  });
});

describe("MediaService.resolveModelInputSize", () => {
  afterEach(() => vi.restoreAllMocks());

  it.each([
    [RealtimeModel.x2_0, 832, 1472],
    [RealtimeModel.x2_1, 1080, 1920],
  ] as const)("keeps the default camera format unchanged for %s", (model, width, height) => {
    const service = new MediaService(model);
    const format = defaultCameraVideoFormat(model);

    expect(format).toMatchObject({ width, height, fps: 30 });
    expect(service.resolveModelInputSize(format)).toEqual({ width, height });
  });

  it.each([RealtimeModel.x2_1])("accepts exact resolution bucket matches for %s", (model) => {
    const service = new MediaService(model);
    expect(service.resolveModelInputSize({ width: 1080, height: 1920 })).toEqual({
      width: 1080,
      height: 1920,
    });
    expect(service.resolveModelInputSize({ width: 1920, height: 1080 })).toEqual({
      width: 1920,
      height: 1080,
    });
  });

  it.each([RealtimeModel.x2_1])("rejects non-bucket resolutions for %s", (model) => {
    const service = new MediaService(model);
    try {
      service.resolveModelInputSize({ width: 832, height: 1472 });
      throw new Error("Expected XmaxError to be thrown");
    } catch (error) {
      expect(error).toBeInstanceOf(XmaxError);
      expect((error as XmaxError).code).toBe(XmaxErrorCode.invalidConfiguration);
    }
  });

  it.each(Object.values(RealtimeModel))("rejects invalid dimensions for %s", (model) => {
    const service = new MediaService(model);
    expect(() => service.resolveModelInputSize({ width: 0, height: 100 })).toThrow(
      XmaxError,
    );
  });

  it.each([
    { width: 1920, height: 1024 },
    { width: 1024, height: 1920 },
    { width: 1920, height: 1080 },
    { width: 640, height: 360 },
    { width: 360, height: 640 },
  ])("scales input $width × $height to the pixel budget when no buckets are configured", (input) => {
    vi.spyOn(ModelDefinition, "resolutionBuckets").mockReturnValue([]);
    const size = new MediaService().resolveModelInputSize(input);

    expect(size.width % 32).toBe(0);
    expect(size.height % 32).toBe(0);
    expect(size.width * size.height).toBeGreaterThanOrEqual(600000);
    expect(size.width * size.height).toBeLessThanOrEqual(2100000);
    expect(size.width / size.height).toBeCloseTo(input.width / input.height, 1);
  });

  it("uses the CN model as the default media service model", () => {
    expect(new MediaService().model).toBe(RealtimeModel.x2_1);
  });
});
