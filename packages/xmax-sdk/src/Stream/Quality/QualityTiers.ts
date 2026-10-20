/** 支持自动调档的 RTC 新轨道/新生成任务的默认启动档位；不改变 L1 恢复上限。 */
export const INITIAL_QUALITY_LEVEL = 2;

/**
 * 自动缩放的短边下限；原始短边更小时不放大。
 */
export const MINIMUM_QUALITY_SHORT_SIDE = 240;

/**
 * 上下行共用的五档缩放比例与上行帧率上限；具体尺寸由媒体基准计算。
 * 网络质量等级不与档位直接映射。
 */
export const QUALITY_TIERS = {
  L1: { scale: 1, frameRate: 30 },
  L2: { scale: 0.8, frameRate: 24 },
  L3: { scale: 0.65, frameRate: 24 },
  L4: { scale: 0.5, frameRate: 20 },
  L5: { scale: 0.4, frameRate: 16 },
} as const;
