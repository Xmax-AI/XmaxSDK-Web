//
//  VideoBeautyOptions.ts
//  XmaxSDK
//
//  Author: 翁跃庭 (Yueting Weng)
//  GitHub: https://github.com/Xmax-AI/XmaxSDK-Web
//
//  Copyright (c) 2026 XMAX.AI PTE. LTD.
//

/**
 * Optional beauty processing for one video view. It changes presentation only, leaving source tracks,
 * publication, frame callbacks, and recordings of the original media unchanged. Strengths range from
 * 0 to 1. Omit the options to disable processing and avoid loading the extension.
 */
export interface VideoBeautyOptions {

  /**
   * Skin smoothing strength; defaults to 0.3.
   */
  smoothness?: number;

  /**
   * Skin lightening strength; defaults to 0.2.
   */
  lightening?: number;

  /**
   * Sharpening strength; defaults to 0.2.
   */
  sharpness?: number;

  /**
   * Skin redness strength; defaults to 0.1.
   */
  redness?: number;
}
