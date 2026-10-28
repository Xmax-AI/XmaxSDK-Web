//
//  RealtimeQualityLevel.ts
//  XmaxSDK
//
//  Author: 翁跃庭 (Yueting Weng)
//  GitHub: https://github.com/Xmax-AI/XmaxSDK-Web
//
//  Copyright (c) 2026 XMAX.AI PTE. LTD.
//

/**
 * Realtime transmission presets, from highest quality (L1) to lowest bandwidth (L5). These presets are
 * independent of network quality ratings.
 */
export enum RealtimeQualityLevel {

  /**
   * Retains the baseline media dimensions.
   */
  l1 = 1,

  /**
   * Targets 90% of the baseline width and height.
   */
  l2 = 2,

  /**
   * Targets 75% of the baseline width and height.
   */
  l3 = 3,

  /**
   * Targets 60% of the baseline width and height.
   */
  l4 = 4,

  /**
   * Targets 50% of the baseline width and height, with an uplink frame-rate limit of 16 fps.
   */
  l5 = 5,
}
