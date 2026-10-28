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
 * Network-quality ratings for a realtime connection.
 */
export enum RealtimeNetworkQualityLevel {

  /**
   * No valid quality estimate is available.
   */
  unknown = "Unknown",

  /**
   * Excellent network quality.
   */
  excellent = "Excellent",

  /**
   * Good network quality.
   */
  good = "Good",

  /**
   * Reduced quality that may affect realtime playback.
   */
  poor = "Poor",

  /**
   * Poor quality affecting realtime playback.
   */
  bad = "Bad",

  /**
   * Very poor quality that may severely interrupt media transport.
   */
  veryBad = "VeryBad",

  /**
   * The network connection is down.
   */
  down = "Down",
}

/**
 * Local RTC connection quality, independent of remote result-stream arrival.
 */
export interface RealtimeNetworkQuality {

  /**
   * The RTC provider's uplink quality rating.
   */
  readonly uplink: RealtimeNetworkQualityLevel;

  /**
   * The average quality of all downlink connections.
   */
  readonly downlink: RealtimeNetworkQualityLevel;
}

/**
 * Receives quality snapshots; undefined means no sample or a cleared connection.
 */
export type RealtimeNetworkQualityListener = (
  statistics: RealtimeNetworkQuality | undefined
) => void;

/**
 * RTC numeric quality ratings from 0 to 6, with invalid ratings mapped to unknown.
 */
const RTC_QUALITY_LEVELS: readonly RealtimeNetworkQualityLevel[] = Object.values(RealtimeNetworkQualityLevel);

/**
 * Maps RTC numeric ratings without treating invalid samples as good network quality.
 */
export function networkQualityLevel(
  value: number | undefined
): RealtimeNetworkQualityLevel {
  return value !== undefined && Number.isInteger(value)
    ? RTC_QUALITY_LEVELS[value] ?? RealtimeNetworkQualityLevel.unknown
    : RealtimeNetworkQualityLevel.unknown;
}
