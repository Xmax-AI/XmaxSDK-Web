//
//  CameraRotation.ts
//  XmaxSDK
//
//  Author: 翁跃庭 (Yueting Weng)
//  GitHub: https://github.com/Xmax-AI/XmaxSDK-Web
//
//  Copyright (c) 2026 XMAX.AI PTE. LTD.
//

import { XmaxError, XmaxErrorCode } from "../../Errors/XmaxError";

/**
 * Clockwise input rotation, independent of front-camera mirroring.
 */
export type CameraRotation = 0 | 90 | 180 | 270;

/**
 * Validates camera rotation as 0, 90, 180, or 270 degrees.
 */
export function validateCameraRotation(
  rotation: number
): asserts rotation is CameraRotation {
  if (![0, 90, 180, 270].includes(rotation)) {
    throw new XmaxError(
      XmaxErrorCode.invalidConfiguration,
      "Camera rotation must be 0, 90, 180 or 270"
    );
  }
}
