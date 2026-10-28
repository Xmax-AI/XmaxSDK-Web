//
//  RtcStatsLogger.ts
//  XmaxSDK
//
//  Author: 翁跃庭 (Yueting Weng)
//  GitHub: https://github.com/Xmax-AI/XmaxSDK-Web
//
//  Copyright (c) 2026 XMAX.AI PTE. LTD.
//

import { XmaxLogger, XmaxLoggerOption } from "../Logging/XmaxLogger";
import { RealtimeNetworkQualityLevel, type RealtimeNetworkQuality } from "./NetworkStatistics";
import type { DownlinkVideoStatistics, UplinkVideoStatistics } from "./VideoStatistics";

/**
 * Connection diagnostics independent of video-statistics callbacks.
 */
interface ConnectionStatistics {

  /**
   * The local-to-RTC-service round-trip time, in milliseconds.
   */
  rttMs?: number;

  /**
   * The connection-level uplink packet-loss percentage.
   */
  uplinkLossPercent?: number;

  /**
   * The connection-level downlink packet-loss percentage.
   */
  downlinkLossPercent?: number;

  /**
   * The connection's cumulative sent byte count.
   */
  sentBytes?: number;

  /**
   * The connection's cumulative received byte count.
   */
  receivedBytes?: number;
}

/**
 * Quality logs with optional direction-specific metrics actually supplied by the provider, not inferred
 * from overall RTT.
 */
interface NetworkQualityStatistics extends RealtimeNetworkQuality {

  /**
   * The uplink round-trip time, in milliseconds.
   */
  uplinkRTT?: number;

  /**
   * The downlink round-trip time, in milliseconds.
   */
  downlinkRTT?: number;

  /**
   * The uplink packet-loss percentage.
   */
  uplinkLoss?: number;

  /**
   * The downlink packet-loss percentage.
   */
  downlinkLoss?: number;
}

/**
 * Writes provider-independent performance logs from shared statistics objects.
 *
 * @internal
 */
export class RtcStatsLogger {

  /**
   * Logs uplink video statistics at info level without formatting when performance logs are disabled.
   */
  static logUplinkVideoStatistics(
    video: UplinkVideoStatistics,
  ): void {
    XmaxLogger.rtc.info(
      () => this.uplinkVideoStatisticsMessage(video),
      XmaxLoggerOption.performance
    );
  }

  /**
   * Formats uplink metrics without substituting send rate for unavailable encoding rate.
   */
  static uplinkVideoStatisticsMessage(
    video: UplinkVideoStatistics,
  ): string {
    return this.block(
      "视频上行统计 (Video Uplink Statistics)",
      [
        `${XmaxLogger.localized("分辨率：", "Resolution: ")}${this.resolution(video.width, video.height)}`,
        `${XmaxLogger.localized("发送码率：", "Send Bitrate: ")}${this.value(video.bitrateKbps, "kbps")}`,
        `${XmaxLogger.localized("采集帧率：", "Capture Frame Rate: ")}${this.value(video.captureFrameRate, "fps")}`,
        `${XmaxLogger.localized("编码帧率：", "Encode Frame Rate: ")}${this.value(video.encodeFrameRate, "fps")}`,
        `${XmaxLogger.localized("发送帧率：", "Send Frame Rate: ")}${this.value(video.sendFrameRate, "fps")}`,
        `${XmaxLogger.localized("视频丢包率：", "Video Packet Loss: ")}${this.value(video.packetLossPercent, "%")}`,
      ]
    );
  }

  /**
   * Logs downlink video statistics using the same object delivered to callbacks.
   */
  static logDownlinkVideoStatistics(
    video: DownlinkVideoStatistics,
  ): void {
    XmaxLogger.rtc.info(
      () => this.downlinkVideoStatisticsMessage(video),
      XmaxLoggerOption.performance
    );
  }

  /**
   * Formats downlink metrics without user identifiers or unapproved native fields.
   */
  static downlinkVideoStatisticsMessage(
    video: DownlinkVideoStatistics,
  ): string {
    return this.block(
      "视频下行统计 (Video Downlink Statistics)",
      [
        `${XmaxLogger.localized("分辨率：", "Resolution: ")}${this.resolution(video.width, video.height)}`,
        `${XmaxLogger.localized("接收码率：", "Receive Bitrate: ")}${this.value(video.bitrateKbps, "kbps")}`,
        `${XmaxLogger.localized("解码帧率：", "Decode Frame Rate: ")}${this.value(video.decodeFrameRate, "fps")}`,
        `${XmaxLogger.localized("渲染帧率：", "Render Frame Rate: ")}${this.value(video.renderFrameRate, "fps")}`,
        `${XmaxLogger.localized("视频丢包率：", "Video Packet Loss: ")}${this.value(video.packetLossPercent, "%")}`,
        `${XmaxLogger.localized("端到端时延：", "End-to-End Delay: ")}${this.value(video.endToEndDelayMs, "ms")}`,
      ]
    );
  }

  /**
   * Logs connection RTT, loss, and cumulative traffic separately from video statistics.
   */
  static logConnectionStatistics(
    stats: ConnectionStatistics,
  ): void {
    XmaxLogger.rtc.info(
      () => this.block(
        "RTC 运行统计 (RTC Statistics)",
        [
          `RTT: ${this.value(stats.rttMs, "ms")}`,
          `${XmaxLogger.localized("上行丢包率：", "Uplink Packet Loss: ")}${this.value(stats.uplinkLossPercent, "%")}`,
          `${XmaxLogger.localized("下行丢包率：", "Downlink Packet Loss: ")}${this.value(stats.downlinkLossPercent, "%")}`,
          `${XmaxLogger.localized("累计发送：", "Bytes Sent: ")}${this.value(stats.sentBytes, "bytes")}`,
          `${XmaxLogger.localized("累计接收：", "Bytes Received: ")}${this.value(stats.receivedBytes, "bytes")}`,
        ]
      ),
      XmaxLoggerOption.performance
    );
  }

  /**
   * Logs common network quality and only the provider's actual direction-specific delay and loss
   * metrics.
   */
  static logNetworkQuality(
    stats: NetworkQualityStatistics,
  ): void {
    XmaxLogger.rtc.info(
      () => {
        const details = (
          rtt?: number,
          loss?: number
        ) => rtt === undefined && loss === undefined
            ? ""
            : `, RTT ${this.value(rtt, "ms")}, ${XmaxLogger.localized("丢包率 ", "Loss ")}${this.value(loss, "%")}`;
        return this.block(
          "网络质量 (Network Quality Metrics)",
          [
            `${XmaxLogger.localized("本地上行：", "Local Uplink: ")}${this.quality(stats.uplink)}${details(stats.uplinkRTT, stats.uplinkLoss)}`,
            `${XmaxLogger.localized("本地下行（平均）：", "Local Downlink (Average): ")}${this.quality(stats.downlink)}${details(stats.downlinkRTT, stats.downlinkLoss)}`,
          ]
        );
      },
      XmaxLoggerOption.performance
    );
  }

  /**
   * Formats resolution only when both dimensions are valid, otherwise returning a placeholder.
   */
  private static resolution(
    width?: number,
    height?: number,
  ): string {
    if (
      typeof width !== "number" || typeof height !== "number" ||
      !Number.isFinite(width) || !Number.isFinite(height) || width <= 0 || height <= 0
    ) {
      return "—";
    }
    return `${width} × ${height}`;
  }

  /**
   * Builds one titled tree of metric lines.
   */
  private static block(
    title: string,
    lines: string[]
  ): string {
    return [title, ...lines.map((
      line,
      index
    ) => `${index === lines.length - 1 ? "└─" : "├─"} ${line}`)].join("\n");
  }

  /**
   * Formats valid zero and fractional values without changing public units, retaining at most two
   * decimal places.
   */
  private static value(
    value: number | undefined,
    unit = ""
  ): string {
    if (typeof value !== "number" || !Number.isFinite(value) || value < 0) {
      return "—";
    }
    return `${Number(value.toFixed(2))}${unit ? ` ${unit}` : ""}`;
  }

  /**
   * Localizes a shared network-quality rating.
   */
  private static quality(
    value: RealtimeNetworkQualityLevel,
  ): string {
    const names: Record<RealtimeNetworkQualityLevel, readonly [string, string]> = {
      [RealtimeNetworkQualityLevel.unknown]: ["未知", "Unknown"],
      [RealtimeNetworkQualityLevel.excellent]: ["极好", "Excellent"],
      [RealtimeNetworkQualityLevel.good]: ["良好", "Good"],
      [RealtimeNetworkQualityLevel.poor]: ["一般", "Poor"],
      [RealtimeNetworkQualityLevel.bad]: ["差", "Bad"],
      [RealtimeNetworkQualityLevel.veryBad]: ["极差", "Very Bad"],
      [RealtimeNetworkQualityLevel.down]: ["断网", "Disconnected"],
    };
    const name = names[value] ?? names[RealtimeNetworkQualityLevel.unknown];
    return XmaxLogger.localized(
      name[0],
      name[1]
    );
  }
}
