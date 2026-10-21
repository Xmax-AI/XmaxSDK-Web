//
//  VeRtcStatistics.ts
//  XmaxSDK
//
//  Author: 翁跃庭 (Yueting Weng)
//  GitHub: https://github.com/Xmax-AI/XmaxSDK-Web
//
//  Copyright (c) 2026 XMAX.AI PTE. LTD.
//

import type { LocalVideoStats, RemoteVideoStats } from "@volcengine/rtc";
import type { VideoStatistics, RemoteVideoStatistics } from "../VideoStatistics";
import type { NetworkQualityLevel } from "../NetworkStatistics";

/**
 * VeRTC 的码率已经是 kbps，丢包率为 0–1；缺失指标不推算。
 */
export class VeRtcStatistics {

  /**
   * 转换 VeRTC 上行视频统计，统一帧率、码率和丢包率单位。
   */
  static local(
    stats: LocalVideoStats
  ): VideoStatistics {
    return Object.freeze({
      width: this.valid(stats.encodedFrameWidth, 1), height: this.valid(stats.encodedFrameHeight, 1),
      frameRate: this.valid(stats.sentFrameRate), bitrateKbps: this.valid(stats.sentKBitrate),
      uplinkLossPercent: this.loss(stats.videoLossRate),
    });
  }

  /**
   * 转换指定远端用户的视频接收统计，保留厂商未提供的指标。
   */
  static remote(
    userID: string,
    stats: RemoteVideoStats,
    uplinkLossPercent?: number
  ): RemoteVideoStatistics {
    return Object.freeze({
      userID, width: this.valid(stats.width, 1), height: this.valid(stats.height, 1),
      frameRate: this.valid(stats.decoderOutputFrameRate), bitrateKbps: this.valid(stats.receivedKBitrate),
      rttMs: this.valid(stats.rtt), downlinkLossPercent: this.loss(stats.videoLossRate),
      endToEndDelayMs: this.valid(stats.e2eDelay), uplinkLossPercent,
    });
  }

  /**
   * 过滤超出公共网络质量等级范围的值。
   */
  static quality(
    value: number
  ): NetworkQualityLevel | undefined {
    return Number.isInteger(value) && value >= 0 && value <= 6 ? value as NetworkQualityLevel : undefined;
  }

  /**
   * 过滤缺失、非有限或不符合取值范围的统计值。
   */
  private static valid(
    value: number | undefined,
    minimum = 0
  ): number | undefined {
    return typeof value === "number" && Number.isFinite(value) && value >= minimum ? value : undefined;
  }

  /**
   * 将厂商提供的丢包比例转换为百分比。
   */
  private static loss(
    value: number
  ): number | undefined {
    return Number.isFinite(value) && value >= 0 && value <= 1 ? value * 100 : undefined;
  }
}
