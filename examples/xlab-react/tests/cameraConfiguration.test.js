import { expect, it } from "vitest";
import { RealtimeCameraPreset, RealtimeModel, cameraPresetSize } from "@xmaxai/web-sdk";
import { resolveCameraConfiguration } from "../src/cameraConfiguration";

it.each(Object.values(RealtimeCameraPreset))("locks X2.0 desktop to 1472×832 regardless of %s", (preset) => {
  const config = resolveCameraConfiguration(RealtimeModel.x2_0, preset, false);
  expect(config.preset).toBe(RealtimeCameraPreset.resolution1920x1080);
  expect(config.isPresetLocked).toBe(true);
  expect(config.videoFormat).toMatchObject({ width: 1472, height: 832, fps: 30 });
});

it.each(Object.values(RealtimeCameraPreset))("locks X2.0 mobile to 832×1472 regardless of %s", (preset) => {
  const config = resolveCameraConfiguration(RealtimeModel.x2_0, preset, true);
  expect(config.preset).toBe(RealtimeCameraPreset.resolution1080x1920);
  expect(config.isPresetLocked).toBe(true);
  expect(config.videoFormat).toMatchObject({ width: 832, height: 1472, fps: 30 });
});

it.each(Object.values(RealtimeCameraPreset))("preserves the X2.1 selection %s on both layouts", (preset) => {
  for (const isMobile of [false, true]) {
    const config = resolveCameraConfiguration(RealtimeModel.x2_1, preset, isMobile);
    expect(config.preset).toBe(preset);
    expect(config.isPresetLocked).toBe(false);
    expect(config.videoFormat).toMatchObject({ ...cameraPresetSize(preset), fps: 30 });
  }
});

it("restores the chosen X2.1 ratio after selecting X2.0", () => {
  const selected = RealtimeCameraPreset.resolution1408x1408;
  resolveCameraConfiguration(RealtimeModel.x2_0, selected, false);
  const config = resolveCameraConfiguration(RealtimeModel.x2_1, selected, false);
  expect(config.preset).toBe(selected);
  expect(config.videoFormat).toMatchObject({ width: 1408, height: 1408 });
});
