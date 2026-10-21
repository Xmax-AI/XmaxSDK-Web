//
//  RealtimeCameraPreset.ts
//  XmaxSDK
//
//  Author: 翁跃庭 (Yueting Weng)
//  GitHub: https://github.com/Xmax-AI/XmaxSDK-Web
//
//  Copyright (c) 2026 XMAX.AI PTE. LTD.
//

import type { ModelSize } from "../../Service/Realtime/RealtimeModel";
import { XmaxError, XmaxErrorCode } from "../../Foundation/Errors/XmaxError";

/**
 * 摄像头分辨率快捷选项；实际支持范围由模型决定。
 */
export enum RealtimeCameraPreset {

  /**
   * 16:9 横向画面。
   */
  resolution1920x1080 = "1920x1080",

  /**
   * 9:16 竖向画面。
   */
  resolution1080x1920 = "1080x1920",

  /**
   * 1:1 正方形画面。
   */
  resolution1408x1408 = "1408x1408",

  /**
   * 3:4 竖向画面。
   */
  resolution1152x1536 = "1152x1536",

  /**
   * 4:3 横向画面。
   */
  resolution1536x1152 = "1536x1152",
}

/**
 * 读取预设的像素宽高，不包含帧率和码率配置。
 */
export function cameraPresetSize(
  preset: RealtimeCameraPreset
): ModelSize {
  if (!Object.values(RealtimeCameraPreset).includes(preset)) {
    throw new XmaxError(XmaxErrorCode.invalidConfiguration, "Unsupported camera preset");
  }
  const [width, height] = preset.split("x").map(Number);
  return { width: width!, height: height! };
}
