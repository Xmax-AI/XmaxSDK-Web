//
//  TrtcRtcStatistics.ts
//  XmaxSDK
//
//  Author: 翁跃庭 (Yueting Weng)
//  GitHub: https://github.com/Xmax-AI/XmaxSDK-Web
//
//  Copyright (c) 2026 XMAX.AI PTE. LTD.
//

import type { NetworkQuality, TRTCStatistics } from "trtc-sdk-v5";
import type { RtcEventListener } from "../RtcEventListener";
import { networkQualityLevel } from "../RtcQualityConverter";
import { RtcStatsLogger } from "../RtcStatsLogger";
import type { UplinkVideoStatistics, DownlinkVideoStatistics } from "../VideoStatistics";

/** Converts TRTC event payloads to SDK statistics and reports them to listeners and logs. */
export class TrtcRtcStatistics {

  /** Reports connection and main-stream video statistics from a TRTC statistics event. */
  static collect(
    stats: TRTCStatistics,
    listener?: RtcEventListener
  ): void {
    RtcStatsLogger.logConnectionStatistics({
      rttMs: stats.rtt,
      uplinkLossPercent: stats.upLoss,
      downlinkLossPercent: stats.downLoss,
      sentBytes: stats.bytesSent,
      receivedBytes: stats.bytesReceived,
    });
    const video = stats.localStatistics?.video?.find((item) => item.videoType === "big");
    const valid = TrtcRtcStatistics.valid;
    // TRTC uplink frameRate is an encoding rate, not a capture or send rate.
    const localVideo: UplinkVideoStatistics | undefined = video ? Object.freeze({
      width: valid(
        video.width,
        1
      ),
      height: valid(
        video.height,
        1
      ),
      encodeFrameRate: valid(
        video.frameRate,
        0
      ),
      bitrateKbps: valid(
        video.bitrate,
        0
      ),
      packetLossPercent: stats.upLoss <= 100 ? valid(
        stats.upLoss,
        0
      ) : undefined,
    }) : undefined;
    listener?.onLocalVideoStatistics?.(localVideo);
    if (localVideo) {
      RtcStatsLogger.logUplinkVideoStatistics(localVideo);
    }

    const remoteVideo: readonly DownlinkVideoStatistics[] = Object.freeze(
      (stats.remoteStatistics ?? []).flatMap((remote) => {
        const video = remote.video?.find((item) => item.videoType === "big");
        if (!video) {
          return [];
        }
        // Use the optional runtime E2E field absent from native typings; do not substitute buffering delay.
        const playback = video as typeof video & {
          point2pointDelay?: number;
        };
        return [Object.freeze({
          userID: remote.userId,
          width: valid(
            video.width,
            1
          ),
          height: valid(
            video.height,
            1
          ),
          decodeFrameRate: valid(
            video.frameRate,
            0
          ),
          bitrateKbps: valid(
            video.bitrate,
            0
          ),
          packetLossPercent: stats.downLoss <= 100 ? valid(
            stats.downLoss,
            0
          ) : undefined,
          endToEndDelayMs: valid(
            playback.point2pointDelay,
            0
          ),
        })];
      }),
    );
    listener?.onRemoteVideoStatistics?.(remoteVideo);
    for (const video of remoteVideo) {
      RtcStatsLogger.logDownlinkVideoStatistics(video);
    }
  }

  /** Reports network ratings and logs the vendor's directional network measurements. */
  static network(
    stats: NetworkQuality,
    listener?: RtcEventListener
  ): void {
    const quality = Object.freeze({
      uplink: networkQualityLevel(stats.uplinkNetworkQuality),
      downlink: networkQualityLevel(stats.downlinkNetworkQuality),
    });
    RtcStatsLogger.logNetworkQuality({
      ...quality,
      uplinkRTT: stats.uplinkRTT,
      downlinkRTT: stats.downlinkRTT,
      uplinkLoss: stats.uplinkLoss,
      downlinkLoss: stats.downlinkLoss,
    });
    listener?.onNetworkStatistics?.(quality);
  }

  /** Filters missing, nonfinite, or out-of-range statistics. */
  private static valid(
    value: number | undefined,
    minimum: number
  ): number | undefined {
    return typeof value === "number" && Number.isFinite(value) && value >= minimum ? value : undefined;
  }
}
