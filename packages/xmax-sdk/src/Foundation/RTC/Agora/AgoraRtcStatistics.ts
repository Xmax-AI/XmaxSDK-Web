//
//  AgoraRtcStatistics.ts
//  XmaxSDK
//
//  Author: 翁跃庭 (Yueting Weng)
//  GitHub: https://github.com/Xmax-AI/XmaxSDK-Web
//
//  Copyright (c) 2026 XMAX.AI PTE. LTD.
//

import type { IAgoraRTCClient, NetworkQuality } from "agora-rtc-sdk-ng";
import type { RtcEventListener } from "../RtcEventListener";
import { networkQualityLevel } from "../RtcQualityConverter";
import { RtcStatsLogger } from "../RtcStatsLogger";
import type { DownlinkVideoStatistics, UplinkVideoStatistics } from "../VideoStatistics";

/**
 * Converts Agora statistics to SDK units without inventing unavailable metrics or playback-buffer delay.
 */
export class AgoraRtcStatistics {

  /**
   * Collects published-video and subscribed-result statistics independently of performance logging.
   */
  static collect(
    client: IAgoraRTCClient,
    listener?: RtcEventListener
  ): void {
    const rtc = client.getRTCStats();
    const local = client.getLocalVideoStats();
    const valid = AgoraRtcStatistics.valid;
    const loss = AgoraRtcStatistics.loss;
    const localVideo: UplinkVideoStatistics | undefined =
      client.localTracks.some(track => track.trackMediaType === "video")
        ? Object.freeze({
          width: valid(
            local.sendResolutionWidth,
            1
          ),
          height: valid(
            local.sendResolutionHeight,
            1
          ),
          captureFrameRate: valid(local.captureFrameRate),
          sendFrameRate: valid(local.sendFrameRate),
          bitrateKbps: valid(local.sendBitrate / 1000),
          packetLossPercent: loss(local.currentPacketLossRate),
        })
        : undefined;
    const remote: readonly DownlinkVideoStatistics[] = Object.freeze(
      Object.entries(client.getRemoteVideoStats()).map(([userID, stats]) => Object.freeze({
        userID,
        width: valid(
          stats.receiveResolutionWidth,
          1
        ),
        height: valid(
          stats.receiveResolutionHeight,
          1
        ),
        decodeFrameRate: valid(stats.decodeFrameRate),
        renderFrameRate: valid(stats.renderFrameRate),
        bitrateKbps: valid(stats.receiveBitrate / 1000),
        packetLossPercent: loss(stats.currentPacketLossRate),
        endToEndDelayMs: valid(stats.end2EndDelay),
      }))
    );
    listener?.onLocalVideoStatistics?.(localVideo);
    listener?.onRemoteVideoStatistics?.(remote);

    RtcStatsLogger.logConnectionStatistics({
      rttMs: valid(rtc.RTT),
      sentBytes: valid(rtc.SendBytes),
      receivedBytes: valid(rtc.RecvBytes),
    });
    if (localVideo) {
      RtcStatsLogger.logUplinkVideoStatistics(localVideo);
    }
    for (const video of remote) {
      RtcStatsLogger.logDownlinkVideoStatistics(video);
    }
  }

  /**
   * Maps network-quality ratings without representing overall RTT as independent directional RTT values.
   */
  static network(
    stats: NetworkQuality,
    listener?: RtcEventListener
  ): void {
    const result = Object.freeze({
      uplink: networkQualityLevel(stats.uplinkNetworkQuality),
      downlink: networkQualityLevel(stats.downlinkNetworkQuality),
    });
    listener?.onNetworkStatistics?.(result);
    RtcStatsLogger.logNetworkQuality(result);
  }

  /**
   * Filters missing, nonfinite, or out-of-range statistics.
   */
  private static valid(
    value: number | undefined,
    minimum = 0
  ): number | undefined {
    return typeof value === "number" && Number.isFinite(value) && value >= minimum ? value : undefined;
  }

  /**
   * Converts Agora loss ratios from 0–1 to percentages.
   */
  private static loss(
    value: number
  ): number | undefined {
    return Number.isFinite(value) && value >= 0 && value <= 1 ? value * 100 : undefined;
  }
}
