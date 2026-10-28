//
//  QualityTiers.ts
//  XmaxSDK
//
//  Author: 翁跃庭 (Yueting Weng)
//  GitHub: https://github.com/Xmax-AI/XmaxSDK-Web
//
//  Copyright (c) 2026 XMAX.AI PTE. LTD.
//

/**
 * The initial adaptive level for new supported RTC tracks or tasks, without changing the L1 recovery
 * ceiling.
 */
export const INITIAL_QUALITY_LEVEL = 2;

/**
 * The adaptive minimum short side; smaller original inputs are not upscaled.
 */
export const MINIMUM_QUALITY_SHORT_SIDE = 240;

/**
 * The five shared dimension scales and uplink frame-rate limits, derived from a media baseline rather
 * than directly mapped from network ratings.
 */
export const QUALITY_TIERS = {
  L1: {
    scale: 1,
    frameRate: 30
  },
  L2: {
    scale: 0.9,
    frameRate: 24
  },
  L3: {
    scale: 0.75,
    frameRate: 24
  },
  L4: {
    scale: 0.6,
    frameRate: 20
  },
  L5: {
    scale: 0.5,
    frameRate: 16
  },
} as const;
