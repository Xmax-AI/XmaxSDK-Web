//
//  RtcQualityConverter.ts
//  XmaxSDK
//
//  Author: 翁跃庭 (Yueting Weng)
//  GitHub: https://github.com/Xmax-AI/XmaxSDK-Web
//
//  Copyright (c) 2026 XMAX.AI PTE. LTD.
//

import { RealtimeNetworkQualityLevel } from "../../Service/Realtime/RealtimeNetworkQuality";

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

