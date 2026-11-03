//
//  RealtimeVideoBeautyOptions.ts
//  XmaxSDK
//
//  Author: 翁跃庭 (Yueting Weng)
//  GitHub: https://github.com/Xmax-AI/XmaxSDK-Web
//
//  Copyright (c) 2026 XMAX.AI PTE. LTD.
//

import { XmaxError, XmaxErrorCode } from "../../Foundation/Errors/XmaxError";

/**
 * Generated-result beauty shared by preview, media frames, and browser media tracks. Strengths are
 * finite numbers from 0 to 1 and default to zero. Input media and publication are unchanged.
 */
export interface RealtimeVideoBeautyOptions {

  /**
   * The skin smoothing strength.
   */
  smoothness?: number;

  /**
   * The skin lightening strength.
   */
  lightening?: number;

  /**
   * The sharpening strength.
   */
  sharpness?: number;

  /**
   * The skin redness strength.
   */
  redness?: number;
}

/**
 * Reports recoverable beauty failures after original-result pixels have been restored.
 */
export type RealtimeVideoBeautyErrorListener = (
  error: XmaxError
) => void;

/**
 * Validates and freezes a complete configuration before replacing active processing.
 *
 * @internal
 */
export function resolvedVideoBeautyOptions(
  options: RealtimeVideoBeautyOptions
): Readonly<Required<RealtimeVideoBeautyOptions>> {
  const resolved = {
    smoothness: options.smoothness ?? 0,
    lightening: options.lightening ?? 0,
    sharpness: options.sharpness ?? 0,
    redness: options.redness ?? 0,
  };
  if (Object.values(resolved).some(value => !Number.isFinite(value) || value < 0 || value > 1)) {
    throw new XmaxError(
      XmaxErrorCode.invalidConfiguration,
      "Beauty strengths must be finite numbers from 0 to 1"
    );
  }
  return Object.freeze(resolved);
}
