import { describe, expect, it } from "vitest";
import * as sdk from "../src/index";
import { XmaxRealtimeManager } from "../src/Core/Realtime/XmaxRealtimeManager";
import type { XmaxRealtimeManaging } from "../src/Core/Realtime/XmaxRealtimeManaging";
import type { RealtimeContextInit } from "../src/Service/Realtime/RealtimeContext";

type MediaCreationMethod = Extract<keyof XmaxRealtimeManaging, `create${string}Stream`>;

describe("realtime media API", () => {
  it("exposes the four locally published media sources", () => {
    const methods: Record<MediaCreationMethod, true> = {
      createLocalCameraStream: true,
      createLocalVideoStream: true,
      createLocalImageStream: true,
      createExternalVideoStream: true,
    };
    for (const method of Object.keys(methods)) {
      expect(XmaxRealtimeManager.prototype).toHaveProperty(method, expect.any(Function));
    }
    expect(XmaxRealtimeManager.prototype).not.toHaveProperty("createNetworkVideoStream");
    expect(sdk).not.toHaveProperty("RealtimeVideoSampleMethod");
    expect(sdk.XmaxVideoView.prototype).not.toHaveProperty("setVideoURL");
  });

  it("keeps the generation context limited to prompt and reference image", () => {
    const fields: Record<keyof RealtimeContextInit, string> = {
      prompt: "  a cat  ",
      referencePath: "  https://example.com/reference.jpg  ",
    };
    expect(new sdk.RealtimeContext(fields)).toEqual({
      prompt: "a cat",
      referencePath: "https://example.com/reference.jpg",
    });
  });
});
