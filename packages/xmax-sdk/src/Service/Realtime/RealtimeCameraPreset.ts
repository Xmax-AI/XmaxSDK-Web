//
//  RealtimeCameraPreset.ts
//  XmaxSDK
//
//  Author: 翁跃庭 (Yueting Weng)
//  GitHub: https://github.com/Xmax-AI/XmaxSDK-Web
//
//  Copyright (c) 2026 XMAX.AI PTE. LTD.
//

import type { ModelSize } from "./RealtimeModel";
import { XmaxError, XmaxErrorCode } from "../../Foundation/Errors/XmaxError";

/**
 * Camera resolution presets; model capabilities determine which presets are supported.
 */
export enum RealtimeCameraPreset {

  /**
   * A landscape 16:9 frame.
   */
  resolution1920x1080 = "1920x1080",

  /**
   * A portrait 9:16 frame.
   */
  resolution1080x1920 = "1080x1920",

  /**
   * A square frame.
   */
  resolution1408x1408 = "1408x1408",

  /**
   * A portrait 3:4 frame.
   */
  resolution1152x1536 = "1152x1536",

  /**
   * A landscape 4:3 frame.
   */
  resolution1536x1152 = "1536x1152",
}

/**
 * Returns the preset dimensions in pixels, without frame-rate or bitrate settings.
 */
export function cameraPresetSize(
  preset: RealtimeCameraPreset
): ModelSize {
  if (!Object.values(RealtimeCameraPreset).includes(preset)) {
    throw new XmaxError(
      XmaxErrorCode.invalidConfiguration,
      "Unsupported camera preset"
    );
  }
  const [width, height] = preset.split("x").map(Number);
  return {
    width: width!,
    height: height!
  };
}
