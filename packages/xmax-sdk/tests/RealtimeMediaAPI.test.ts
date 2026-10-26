import { describe, expect, it } from "vitest";
import * as sdk from "../src/index";
import * as react from "../src/react/index";
import { XmaxRealtimeVideoView } from "../src/Render/Video/XmaxRealtimeVideoView";
import { XmaxRealtimeDualVideoView } from "../src/Render/Video/XmaxRealtimeDualVideoView";
import { XmaxRealtimeManager } from "../src/Core/Realtime/XmaxRealtimeManager";
import type { XmaxRealtimeManaging } from "../src/Core/Realtime/XmaxRealtimeManaging";
import type { RealtimeContextInit } from "../src/Service/Realtime/RealtimeContext";

type MediaCreationMethod = Extract<keyof XmaxRealtimeManaging, `create${string}Stream`>;

describe("realtime media API", () => {
  it("exports distinct single-track and dual-track views", () => {
    expect(sdk.XmaxRealtimeVideoView).toBe(XmaxRealtimeVideoView);
    expect(sdk.XmaxRealtimeDualVideoView).toBe(XmaxRealtimeDualVideoView);
    expect(sdk).not.toHaveProperty("XmaxVideoView");
  });

  it("exports matching React component names", () => {
    expect(react.XmaxRealtimeVideo).toBeTypeOf("function");
    expect(react.XmaxRealtimeDualVideo).toBeTypeOf("function");
    expect(react).not.toHaveProperty("XmaxVideo");
  });

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
    expect(sdk.XmaxRealtimeVideoView.prototype).not.toHaveProperty("setVideoURL");
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
