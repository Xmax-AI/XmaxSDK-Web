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
  it("accepts external source/sink input while preserving the legacy track form", () => {
    const source: sdk.RealtimeExternalVideoSource = {
      videoFormat: new sdk.RealtimeVideoFormat({ width: 1280, height: 720, fps: 30 }),
      hasAudio: true,
      async start(sink) {
        const onVideo = (frame: VideoFrame) => sink.pushVideo(frame);
        const onAudio = (frame: sdk.RealtimeExternalAudioFrame) => sink.pushAudio(frame);
        expect(onVideo).toBeTypeOf("function");
        expect(onAudio).toBeTypeOf("function");
      },
      async stop() {},
    };
    const options: sdk.RealtimeExternalVideoStreamOptions = { source };
    // @ts-expect-error A source cannot be combined with legacy track options.
    const mixed: sdk.RealtimeExternalVideoStreamOptions = { source, videoTrack: {} as MediaStreamTrack, videoFormat: source.videoFormat };
    expect(options.source?.hasAudio).toBe(true);
    expect(mixed).toHaveProperty("videoTrack");
    expect(XmaxRealtimeManager.prototype.stopExternalVideoStream).toBeTypeOf("function");
  });

  it("accepts either a camera preset or an explicit video format", () => {
    type CameraOptions = Parameters<XmaxRealtimeManaging["createLocalCameraStream"]>[0];
    const common = { position: sdk.CameraPosition.front, useMicrophone: false };
    const preset: CameraOptions = { ...common, preset: sdk.RealtimeCameraPreset.resolution1080x1920 };
    const format: CameraOptions = { ...common, videoFormat: new sdk.RealtimeVideoFormat({ width: 1080, height: 1920, fps: 24 }) };
    // @ts-expect-error A preset and an explicit format cannot be combined.
    const both: CameraOptions = { ...common, preset: sdk.RealtimeCameraPreset.resolution1080x1920, videoFormat: format.videoFormat };
    // @ts-expect-error A format selector is required.
    const neither: CameraOptions = common;
    expect(preset.preset).toBe(sdk.RealtimeCameraPreset.resolution1080x1920);
    expect(format.videoFormat.fps).toBe(24);
    expect(both).toHaveProperty("preset");
    expect(neither).not.toHaveProperty("videoFormat");
  });

  it("exposes media packets instead of SDK-managed recording", () => {
    expect(XmaxRealtimeManager.prototype.setRemoteMediaFrameListener).toBeTypeOf("function");
    expect(XmaxRealtimeManager.prototype).not.toHaveProperty("setRecordingListener");
    expect(sdk).not.toHaveProperty("RealtimeRecordingEventType");
    type StartOptions = Parameters<XmaxRealtimeManaging["startGeneration"]>[0];
    const hasRecord: "record" extends keyof StartOptions ? true : false = false;
    expect(hasRecord).toBe(false);
  });
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
