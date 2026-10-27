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
import { networkQualityLevel } from "../NetworkStatistics";
import { RtcStatsLogger } from "../RtcStatsLogger";
import type { DownlinkVideoStatistics, UplinkVideoStatistics } from "../VideoStatistics";

/**
 * 将声网统计转换为 SDK 公共单位，保留厂商缺失指标，不推算播放缓冲延迟。
 */
export class AgoraRtcStatistics {

  /**
   * 采集已发布的视频和已订阅的结果流统计，性能日志不控制回调采集。
   */
  static collect(
    client: IAgoraRTCClient,
    listener?: RtcEventListener
  ): void {
    const rtc = client.getRTCStats();
    const local = client.getLocalVideoStats();
    const valid = AgoraRtcStatistics.valid;
    const loss = AgoraRtcStatistics.loss;
    const localVideo: UplinkVideoStatistics | undefined = client.localTracks.some(track => track.trackMediaType === "video") ? Object.freeze({
      width: valid(local.sendResolutionWidth, 1), height: valid(local.sendResolutionHeight, 1),
      captureFrameRate: valid(local.captureFrameRate), sendFrameRate: valid(local.sendFrameRate),
      bitrateKbps: valid(local.sendBitrate / 1000), packetLossPercent: loss(local.currentPacketLossRate),
    }) : undefined;
    const remote: readonly DownlinkVideoStatistics[] = Object.freeze(Object.entries(client.getRemoteVideoStats()).map(([userID, stats]) => Object.freeze({
      userID, width: valid(stats.receiveResolutionWidth, 1), height: valid(stats.receiveResolutionHeight, 1),
      decodeFrameRate: valid(stats.decodeFrameRate), renderFrameRate: valid(stats.renderFrameRate),
      bitrateKbps: valid(stats.receiveBitrate / 1000),
      packetLossPercent: loss(stats.currentPacketLossRate), endToEndDelayMs: valid(stats.end2EndDelay),
    })));
    listener?.onLocalVideoStatistics?.(localVideo);
    listener?.onRemoteVideoStatistics?.(remote);

    RtcStatsLogger.logConnectionStatistics({
      rttMs: valid(rtc.RTT), sentBytes: valid(rtc.SendBytes), receivedBytes: valid(rtc.RecvBytes),
    });
    if (localVideo) {
      RtcStatsLogger.logUplinkVideoStatistics(localVideo);
    }
    for (const video of remote) {
      RtcStatsLogger.logDownlinkVideoStatistics(video);
    }
  }

  /**
   * 网络质量等级范围与公共枚举一致；不将整体 RTT 冒充上下行独立 RTT。
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
   * 过滤缺失、非有限或不合理的统计值。
   */
  private static valid(
    value: number | undefined,
    minimum = 0
  ): number | undefined {
    return typeof value === "number" && Number.isFinite(value) && value >= minimum ? value : undefined;
  }

  /**
   * 声网丢包率为 0–1 比例，转换为公共百分比。
   */
  private static loss(
    value: number
  ): number | undefined {
    return Number.isFinite(value) && value >= 0 && value <= 1 ? value * 100 : undefined;
  }
}
