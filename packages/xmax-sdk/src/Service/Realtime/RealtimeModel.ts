//
//  RealtimeModel.ts
//  XmaxSDK
//
//  Author: 翁跃庭 (Yueting Weng)
//  GitHub: https://github.com/Xmax-AI/XmaxSDK-Web
//
//  Copyright (c) 2026 XMAX.AI PTE. LTD.
//

import { RealtimeVideoFormat } from "./RealtimeVideoFormat";
import { RtcProvider } from "../../Foundation/RTC/RtcProvider";
import { XmaxError, XmaxErrorCode } from "../../Foundation/Errors/XmaxError";

/**
 * The built-in realtime generation models.
 */
export enum RealtimeModel {

  /**
   * The X2.0 model using VeRTC.
   */
  x2_0 = "x2.0",

  /**
   * The X2.1 model using Agora.
   */
  x2_1 = "x2.1",

  /**
   * The X2.1 Flash model, with Agora as its default RTC provider.
   */
  x2_1_flash = "x2.1-flash",
}

/**
 * A built-in or server-defined model ID. Custom IDs are forwarded unchanged.
 */
export type RealtimeModelName = RealtimeModel | (string & {});

/**
 * Validates a nonempty model ID and identifies built-in models.
 */
function isKnownModel(
  model: RealtimeModelName
): model is RealtimeModel {
  if (typeof model !== "string" || !model.trim()) {
    throw new XmaxError(
      XmaxErrorCode.invalidConfiguration,
      "Realtime model must be a non-empty string"
    );
  }
  return Object.values(RealtimeModel).includes(model as RealtimeModel);
}

/**
 * Resolves local defaults without replacing the requested model ID or looking up inherited properties.
 */
function modelDefaults(
  model: RealtimeModelName
): RealtimeModel {
  return isKnownModel(model) ? model : RealtimeModel.x2_1;
}

/**
 * Model display names, independent of API model IDs.
 */
const MODEL_DISPLAY_NAMES: Readonly<Record<RealtimeModel, string>> = {
  [RealtimeModel.x2_0]: "X2.0",
  [RealtimeModel.x2_1]: "X2.1",
  [RealtimeModel.x2_1_flash]: "X2.1 Flash",
};

/**
 * Model input dimensions in pixels.
 */
export interface ModelSize {

  /**
   * The video width, in pixels.
   */
  width: number;

  /**
   * The video height, in pixels.
   */
  height: number;
}

/**
 * Fixed input resolutions per model. An empty list selects pixel-budget and alignment rules instead.
 */
const RESOLUTION_BUCKETS: Record<RealtimeModel, ModelSize[]> = {
  [RealtimeModel.x2_0]: [],
  [RealtimeModel.x2_1]: [
    {
      width: 1920,
      height: 1080
    },
    {
      width: 1080,
      height: 1920
    },
    {
      width: 1408,
      height: 1408
    },
    {
      width: 1152,
      height: 1536
    },
    {
      width: 1536,
      height: 1152
    },
  ],
  [RealtimeModel.x2_1_flash]: [
    {
      width: 704,
      height: 1280
    },
    {
      width: 1280,
      height: 704
    },
    {
      width: 960,
      height: 960
    },
    {
      width: 1024,
      height: 768
    },
    {
      width: 768,
      height: 1024
    },
  ],
};

/**
 * The maximum local-frame pixel count, also limiting generation canvases without fixed resolutions.
 */
const MAXIMUM_INPUT_PIXELS: Record<RealtimeModel, number> = {
  [RealtimeModel.x2_0]: 1280000,
  [RealtimeModel.x2_1]: 2100000,
  [RealtimeModel.x2_1_flash]: 960 * 960,
};

/**
 * Returns the model's display name.
 */
export function modelDisplayName(
  model: RealtimeModelName
): string {
  return isKnownModel(model) ? MODEL_DISPLAY_NAMES[model] : model;
}

/**
 * Uses the client's realtime endpoint for built-in and custom model IDs.
 */
export function modelBaseURL(
  model: RealtimeModelName
): string | undefined {
  isKnownModel(model);
  return undefined;
}

/**
 * Returns fixed video formats at the recommended frame rate, or an empty list for pixel-budget sizing.
 */
export function supportedVideoFormats(
  model: RealtimeModelName
): RealtimeVideoFormat[] {
  return resolutionBuckets(model).map(size => new RealtimeVideoFormat({
    ...size,
    fps: defaultFrameRate(model)
  }));
}

/**
 * Returns fixed input resolutions, or an empty list for pixel-budget and alignment-based sizing.
 */
export function resolutionBuckets(
  model: RealtimeModelName
): ModelSize[] {
  return RESOLUTION_BUCKETS[modelDefaults(model)];
}

/**
 * Returns the minimum input pixel count used when no fixed resolutions exist.
 */
export function minimumInputPixels(
  _model: RealtimeModelName
): number {
  return 600000;
}

/**
 * Returns the maximum input pixel count used when no fixed resolutions exist.
 */
export function maximumInputPixels(
  model: RealtimeModelName
): number {
  return MAXIMUM_INPUT_PIXELS[modelDefaults(model)];
}

/**
 * Returns the width and height alignment used when no fixed resolutions exist.
 */
export function inputSizeAlignment(
  _model: RealtimeModelName
): number {
  return 32;
}

/**
 * Returns the default frame rate for media sources without an explicit format.
 */
export function defaultFrameRate(
  _model: RealtimeModelName
): number {
  return 30;
}

/**
 * Returns the default camera capture format.
 */
export function defaultCameraVideoFormat(
  model: RealtimeModelName
): RealtimeVideoFormat {
  const buckets = resolutionBuckets(model);
  const size = buckets.find(({ width, height }) => width < height) ?? buckets[0] ?? {
    width: 832,
    height: 1472
  };
  return new RealtimeVideoFormat({
    ...size,
    fps: defaultFrameRate(model)
  });
}

/**
 * Configurable providers with Agora as the default.
 */
const CUSTOM_MODEL_RTC_PROVIDERS: readonly RtcProvider[] = Object.freeze([
  RtcProvider.agora,
  ...Object.values(RtcProvider).filter(provider => provider !== RtcProvider.agora),
]);

/**
 * Supported RTC providers per model, with the default first. Frozen lists prevent mutation of shared
 * capabilities.
 */
const MODEL_RTC_PROVIDERS: Readonly<Record<RealtimeModel, readonly RtcProvider[]>> = {
  [RealtimeModel.x2_0]: Object.freeze([RtcProvider.vertc]),
  [RealtimeModel.x2_1]: Object.freeze([RtcProvider.agora]),
  [RealtimeModel.x2_1_flash]: CUSTOM_MODEL_RTC_PROVIDERS,
};

/**
 * Returns configurable RTC providers, with the default first. Custom models default to Agora and allow
 * other integrated providers; server-side model support is determined by the service.
 */
export function supportedRtcProviders(
  model: RealtimeModelName
): readonly RtcProvider[] {
  return isKnownModel(model) ? MODEL_RTC_PROVIDERS[model] : CUSTOM_MODEL_RTC_PROVIDERS;
}
