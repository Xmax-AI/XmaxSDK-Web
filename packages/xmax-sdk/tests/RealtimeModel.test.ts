import { describe, expect, it } from "vitest";
import {
  RealtimeModel, defaultCameraVideoFormat, defaultFrameRate, inputSizeAlignment,
  maximumInputPixels, minimumInputPixels, modelBaseURL, modelDisplayName, resolutionBuckets,
  supportedRtcProviders, supportedVideoFormats,
} from "../src/Service/Realtime/RealtimeModel";
import { MediaService } from "../src/Service/Media/MediaService";
import { XmaxClient } from "../src/Core/XmaxClient";
import { XmaxConfiguration } from "../src/Core/XmaxConfiguration";
import { RealtimeConfiguration } from "../src/Core/Realtime/RealtimeConfiguration";
import { RtcProvider } from "../src/Foundation/RTC/RtcProvider";
import { XmaxEnvironment, realtimeApiBaseURL, apiBaseURL } from "../src/Core/XmaxEnvironment";

describe("custom realtime models", () => {
  it.each(["future-model", "x2.1-trtc", "x2.1-debug", "x2.1-debug-other", "toString", "__proto__", "constructor"])("uses environment routing and preview media defaults without replacing the identifier %s", (model) => {
    const preview = RealtimeModel.x2_1;
    expect(modelDisplayName(model)).toBe(model);
    expect(modelBaseURL(model)).toBeUndefined();
    expect(resolutionBuckets(model)).toEqual(resolutionBuckets(preview));
    expect(defaultCameraVideoFormat(model)).toEqual(defaultCameraVideoFormat(preview));
    expect(defaultFrameRate(model)).toBe(defaultFrameRate(preview));
    expect(minimumInputPixels(model)).toBe(minimumInputPixels(preview));
    expect(maximumInputPixels(model)).toBe(maximumInputPixels(preview));
    expect(inputSizeAlignment(model)).toBe(inputSizeAlignment(preview));

    const client = new XmaxClient(new XmaxConfiguration({ apiKey: "test-key" }));
    const configuration = new RealtimeConfiguration({ model });
    expect(client.createRealtimeManager(configuration).options.model).toBe(model);
    const media = client.createMediaService(model);
    for (const size of [{ width: 1080, height: 1920 }, { width: 1920, height: 1080 }]) {
      expect(media.resolveModelInputSize(size)).toEqual(size);
    }
    expect(() => media.resolveModelInputSize({ width: 640, height: 360 })).toThrow("does not support input resolution");
    expect(new MediaService(model).model).toBe(model);
  });

  it.each(["", "   "])("rejects an empty model name before resolving its endpoint: %j", model => {
    expect(() => modelBaseURL(model)).toThrow("non-empty string");
  });

  it("exposes the built-in models and defaults media rules to X2.1", () => {
    expect(Object.values(RealtimeModel)).toEqual([
      "x2.0", "x2.1", "x2.1-flash",
    ]);
    expect(new XmaxClient(new XmaxConfiguration({ apiKey: "test-key" })).createMediaService())
      .toMatchObject({ model: RealtimeModel.x2_1 });
  });
});

describe("realtime model capabilities", () => {
  it.each([
    [RealtimeModel.x2_0, "X2.0", RtcProvider.vertc, 832, 1472, 1280000],
    [RealtimeModel.x2_1, "X2.1", RtcProvider.agora, 1080, 1920, 2100000],
  ] as const)("uses the expected RTC and media defaults for %s", (model, displayName, provider, width, height, pixels) => {
    expect(modelDisplayName(model)).toBe(displayName);
    expect(modelBaseURL(model)).toBeUndefined();
    expect(supportedRtcProviders(model)).toEqual([provider]);
    expect(new RealtimeConfiguration({ model })).toMatchObject({ model, provider });
    expect(defaultCameraVideoFormat(model)).toMatchObject({ width, height, fps: 30 });
    expect(defaultFrameRate(model)).toBe(30);
    expect(maximumInputPixels(model)).toBe(pixels);
    expect(minimumInputPixels(model)).toBe(600000);
    expect(inputSizeAlignment(model)).toBe(32);
  });

  it("supports five X2.1 formats and keeps X2.0 pixel-budget sizing", () => {
    expect(supportedVideoFormats(RealtimeModel.x2_1)).toMatchObject([
      { width: 1920, height: 1080, fps: 30 }, { width: 1080, height: 1920, fps: 30 },
      { width: 1408, height: 1408, fps: 30 }, { width: 1152, height: 1536, fps: 30 },
      { width: 1536, height: 1152, fps: 30 },
    ]);
    expect(supportedVideoFormats(RealtimeModel.x2_0)).toEqual([]);
    expect(resolutionBuckets(RealtimeModel.x2_0)).toEqual([]);
  });

  it("uses the five Flash resolutions for camera capture and file generation", () => {
    const model = RealtimeModel.x2_1_flash;
    const media = new MediaService(model);
    const sizes = [
      { width: 704, height: 1280 },
      { width: 1280, height: 704 },
      { width: 960, height: 960 },
      { width: 1024, height: 768 },
      { width: 768, height: 1024 },
    ];
    expect(supportedVideoFormats(model)).toMatchObject(sizes.map(size => ({ ...size, fps: 30 })));
    expect(defaultCameraVideoFormat(model)).toMatchObject({ width: 704, height: 1280, fps: 30 });
    expect(new RealtimeConfiguration({ model }).provider).toBe(RtcProvider.agora);
    expect(new RealtimeConfiguration({ model, provider: RtcProvider.trtc }).provider).toBe(RtcProvider.trtc);
    for (const size of sizes) {
      expect(media.resolveMediaSize(size, "camera")).toEqual(size);
      const input = media.resolveMediaSize({ width: size.width * 2, height: size.height * 2 }, "video");
      expect(media.resolveGenerationSize(input)).toEqual(size);
    }
    expect(() => media.resolveMediaSize({ width: 1920, height: 1080 }, "camera")).toThrow("does not support input resolution");
  });

  it("routes realtime sessions by environment separately from storage", () => {
    expect(realtimeApiBaseURL(XmaxEnvironment.china)).toBe("https://cloud.xmax.22duck.cn/open/api/v1");
    expect(realtimeApiBaseURL(XmaxEnvironment.global)).toBe("https://api.xmax.ai/open/api/v1");
    expect(apiBaseURL(XmaxEnvironment.global)).toBe("https://api.xmax.cloud/open/api/v1");
  });
});
