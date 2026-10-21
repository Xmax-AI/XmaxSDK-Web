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
 * 在缩放上限内计算对齐尺寸，优先保持精确宽高比，不放大源画面。
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
    throw new XmaxError(XmaxErrorCode.invalidConfiguration, "Invalid video size or alignment");
  }

  let divisor = width;
  let remainder = height;
  while (remainder !== 0) {
    [divisor, remainder] = [remainder, divisor % remainder];
  }

  // 最简比例的公共倍数同时满足像素对齐，避免宽高分别取整改变比例。
  const units = Math.floor(divisor * scale / alignment) * alignment;
  if (units >= alignment) {
    return { width: width / divisor * units, height: height / divisor * units };
  }

  const alignedWidth = Math.floor(width * scale / alignment) * alignment;
  const alignedHeight = Math.floor(height * scale / alignment) * alignment;
  if (alignedWidth < alignment || alignedHeight < alignment) {
    throw new XmaxError(XmaxErrorCode.invalidConfiguration, "No aligned video size is available within the size limits");
  }
  return { width: alignedWidth, height: alignedHeight };
}
