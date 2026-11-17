//
//  RealtimeCameraFormat.ts
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
 * Predefined camera dimensions. The active model determines which formats it supports.
 */
export enum RealtimeCameraFormat {

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

  /**
   * A portrait 11:20 frame for X2.1 Flash.
   */
  resolution704x1280 = "704x1280",

  /**
   * A landscape 20:11 frame for X2.1 Flash.
   */
  resolution1280x704 = "1280x704",

  /**
   * A square frame for X2.1 Flash.
   */
  resolution960x960 = "960x960",

  /**
   * A landscape 4:3 frame for X2.1 Flash.
   */
  resolution1024x768 = "1024x768",

  /**
   * A portrait 3:4 frame for X2.1 Flash.
   */
  resolution768x1024 = "768x1024",
}

/**
 * Returns the camera format dimensions in pixels.
 */
export function cameraFormatSize(
  format: RealtimeCameraFormat
): ModelSize {
  if (!Object.values(RealtimeCameraFormat).includes(format)) {
    throw new XmaxError(
      XmaxErrorCode.invalidConfiguration,
      "Unsupported camera format"
    );
  }
  const [width, height] = format.split("x").map(Number);
  return {
    width: width!,
    height: height!
  };
}
