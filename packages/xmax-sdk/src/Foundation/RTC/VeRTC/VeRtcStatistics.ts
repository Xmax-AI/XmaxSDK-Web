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
import type { UplinkVideoStatistics, DownlinkVideoStatistics } from "../VideoStatistics";

/**
 * Converts VeRTC statistics without inferring missing metrics; native bitrate is already kbps and loss
 * is a ratio.
 */
export class VeRtcStatistics {

  /**
   * Normalizes local video frame rates, bitrate, and packet loss.
   */
  static local(
    stats: LocalVideoStats
  ): UplinkVideoStatistics {
    return Object.freeze({
      width: this.valid(
        stats.encodedFrameWidth,
        1
      ),
      height: this.valid(
        stats.encodedFrameHeight,
        1
      ),
      captureFrameRate: this.valid(stats.inputFrameRate),
      encodeFrameRate: this.valid(stats.encoderOutputFrameRate),
      sendFrameRate: this.valid(stats.sentFrameRate),
      bitrateKbps: this.valid(stats.sentKBitrate),
      packetLossPercent: this.loss(stats.videoLossRate),
    });
  }

  /**
   * Normalizes one remote user's received-video statistics while retaining unavailable metrics.
   */
  static remote(
    userID: string,
    stats: RemoteVideoStats
  ): DownlinkVideoStatistics {
    return Object.freeze({
      userID,
      width: this.valid(
        stats.width,
        1
      ),
      height: this.valid(
        stats.height,
        1
      ),
      decodeFrameRate: this.valid(stats.decoderOutputFrameRate),
      renderFrameRate: this.valid(stats.rendererOutputFrameRate),
      bitrateKbps: this.valid(stats.receivedKBitrate),
      packetLossPercent: this.loss(stats.videoLossRate),
      endToEndDelayMs: this.valid(stats.e2eDelay),
    });
  }

  /**
   * Filters missing, nonfinite, and out-of-range statistics.
   */
  private static valid(
    value: number | undefined,
    minimum = 0
  ): number | undefined {
    return typeof value === "number" && Number.isFinite(value) && value >= minimum ? value : undefined;
  }

  /**
   * Converts native packet-loss ratios to percentages.
   */
  private static loss(
    value: number
  ): number | undefined {
    return Number.isFinite(value) && value >= 0 && value <= 1 ? value * 100 : undefined;
  }
}
