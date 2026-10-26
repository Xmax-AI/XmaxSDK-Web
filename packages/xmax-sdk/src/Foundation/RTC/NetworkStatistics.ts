//
//  NetworkStatistics.ts
//  XmaxSDK
//
//  Author: 翁跃庭 (Yueting Weng)
//  GitHub: https://github.com/Xmax-AI/XmaxSDK-Web
//
//  Copyright (c) 2026 XMAX.AI PTE. LTD.
//

/**
 * 实时连接的网络质量等级。
 */
export enum RealtimeNetworkQualityLevel {

  /**
   * 尚无有效的质量评估。
   */
  unknown = "Unknown",

  /**
   * 网络质量极好。
   */
  excellent = "Excellent",

  /**
   * 网络质量良好。
   */
  good = "Good",

  /**
   * 网络质量一般，可能影响实时播放。
   */
  poor = "Poor",

  /**
   * 网络质量差，影响实时播放。
   */
  bad = "Bad",

  /**
   * 网络质量极差，可能严重中断媒体传输。
   */
  veryBad = "VeryBad",

  /**
   * 网络连接已断开。
   */
  down = "Down",
}

/**
 * 本端 RTC 连接的网络统计，不依赖远端生成流是否已经到达。
 */
export interface RealtimeNetworkQuality {

  /**
   * 上行网络质量等级，沿用 RTC 厂商的评估结果。
   */
  readonly uplink: RealtimeNetworkQualityLevel;

  /**
   * 所有下行连接的平均网络质量。
   */
  readonly downlink: RealtimeNetworkQualityLevel;
}

/**
 * undefined 表示尚无采样或连接已清理。
 */
export type RealtimeNetworkQualityListener = (
  statistics: RealtimeNetworkQuality | undefined
) => void;

/**
 * RTC 厂商使用的 0～6 质量等级映射；无效等级统一为 unknown。
 */
const RTC_QUALITY_LEVELS: readonly RealtimeNetworkQualityLevel[] = Object.values(RealtimeNetworkQualityLevel);

/**
 * 将 RTC 数值等级转换为 SDK 网络质量枚举，不把无效样本当作好网络。
 */
export function networkQualityLevel(
  value: number | undefined
): RealtimeNetworkQualityLevel {
  return value !== undefined && Number.isInteger(value)
    ? RTC_QUALITY_LEVELS[value] ?? RealtimeNetworkQualityLevel.unknown
    : RealtimeNetworkQualityLevel.unknown;
}
