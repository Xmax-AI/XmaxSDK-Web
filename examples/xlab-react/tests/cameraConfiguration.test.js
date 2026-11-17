import { expect, it } from "vitest";
import { RealtimeCameraFormat, RealtimeModel, cameraFormatSize } from "@xmaxai/web-sdk";
import { captureResolutionOptions, resolveCameraConfiguration } from "../src/cameraConfiguration";

it("offers common preferred sizes when camera capabilities are unavailable", () => {
  expect(captureResolutionOptions().map(({ key }) => key)).toEqual(expect.arrayContaining([
    "1280×720", "1080×1920", "3840×2160",
  ]));
});

it("filters preferred sizes using both width and height limits", () => {
  const sizes = captureResolutionOptions({ width: { min: 640, max: 1280 }, height: { min: 720, max: 1080 } });
  expect(sizes).toEqual([{ width: 1280, height: 720, key: "1280×720" }]);
});

it.each(Object.values(RealtimeCameraFormat))("locks X2.0 desktop to 1472×832 regardless of %s", (preset) => {
  const config = resolveCameraConfiguration(RealtimeModel.x2_0, preset, false);
  expect(config.preset).toBe(RealtimeCameraFormat.resolution1920x1080);
  expect(config.isPresetLocked).toBe(true);
  expect(config.videoFormat).toMatchObject({ width: 1472, height: 832, fps: 30 });
});

it.each(Object.values(RealtimeCameraFormat))("locks X2.0 mobile to 832×1472 regardless of %s", (preset) => {
  const config = resolveCameraConfiguration(RealtimeModel.x2_0, preset, true);
  expect(config.preset).toBe(RealtimeCameraFormat.resolution1080x1920);
  expect(config.isPresetLocked).toBe(true);
  expect(config.videoFormat).toMatchObject({ width: 832, height: 1472, fps: 30 });
});

const modelPresets = [
  [RealtimeCameraFormat.resolution1920x1080, RealtimeCameraFormat.resolution1280x704],
  [RealtimeCameraFormat.resolution1080x1920, RealtimeCameraFormat.resolution704x1280],
  [RealtimeCameraFormat.resolution1408x1408, RealtimeCameraFormat.resolution960x960],
  [RealtimeCameraFormat.resolution1152x1536, RealtimeCameraFormat.resolution768x1024],
  [RealtimeCameraFormat.resolution1536x1152, RealtimeCameraFormat.resolution1024x768],
];

it.each(modelPresets)("preserves the X2.1 selection %s on both layouts", (preset) => {
  for (const isMobile of [false, true]) {
    const config = resolveCameraConfiguration(RealtimeModel.x2_1, preset, isMobile);
    expect(config.preset).toBe(preset);
    expect(config.isPresetLocked).toBe(false);
    expect(config.videoFormat).toMatchObject({ ...cameraFormatSize(preset), fps: 30 });
  }
});

it.each(modelPresets)("switches camera preset %s to the matching Flash preset %s", (preset, flashPreset) => {
  const flash = resolveCameraConfiguration(RealtimeModel.x2_1_flash, preset, false);
  expect(flash.preset).toBe(flashPreset);
  expect(flash.videoFormat).toMatchObject({ ...cameraFormatSize(flashPreset), fps: 30 });
  expect(flash.presets).toHaveLength(5);
  expect(flash.presets).toEqual(expect.arrayContaining(modelPresets.map(([, flash]) => flash)));
  expect(resolveCameraConfiguration(RealtimeModel.x2_1, flashPreset, false).preset).toBe(preset);
});

it("restores the chosen X2.1 ratio after selecting X2.0", () => {
  const selected = RealtimeCameraFormat.resolution1408x1408;
  resolveCameraConfiguration(RealtimeModel.x2_0, selected, false);
  const config = resolveCameraConfiguration(RealtimeModel.x2_1, selected, false);
  expect(config.preset).toBe(selected);
  expect(config.videoFormat).toMatchObject({ width: 1408, height: 1408 });
});
