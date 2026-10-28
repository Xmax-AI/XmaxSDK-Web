//
//  VideoSize.ts
//  XmaxSDK
//
//  Author: 翁跃庭 (Yueting Weng)
//  GitHub: https://github.com/Xmax-AI/XmaxSDK-Web
//
//  Copyright (c) 2026 XMAX.AI PTE. LTD.
//

import { XmaxError, XmaxErrorCode } from "../../Errors/XmaxError";

/**
 * Computes aligned dimensions within a scale limit, preferring the exact aspect ratio without upscaling.
 */
export function alignedVideoSize(
  size: {
    width: number;
    height: number
  },
  scale: number,
  alignment: number,
): {
  width: number;
  height: number
} {
  const { width, height } = size;
  if (![width, height, alignment].every(value => Number.isSafeInteger(value) && value > 0) ||
    !Number.isFinite(scale) || scale <= 0 || scale > 1) {
    throw new XmaxError(
      XmaxErrorCode.invalidConfiguration,
      "Invalid video size or alignment"
    );
  }

  let divisor = width;
  let remainder = height;
  while (remainder !== 0) {
    [divisor, remainder] = [remainder, divisor % remainder];
  }

  // Use a common multiple of the reduced aspect ratio to avoid independent rounding changing its proportions.
  const units = Math.floor(divisor * scale / alignment) * alignment;
  if (units >= alignment) {
    return {
      width: width / divisor * units,
      height: height / divisor * units
    };
  }

  const alignedWidth = Math.floor(width * scale / alignment) * alignment;
  const alignedHeight = Math.floor(height * scale / alignment) * alignment;
  if (alignedWidth < alignment || alignedHeight < alignment) {
    throw new XmaxError(
      XmaxErrorCode.invalidConfiguration,
      "No aligned video size is available within the size limits"
    );
  }
  return {
    width: alignedWidth,
    height: alignedHeight
  };
}
