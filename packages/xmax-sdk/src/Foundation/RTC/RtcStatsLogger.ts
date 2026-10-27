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
 * RTC 连接层的通用诊断指标，独立于视频统计回调。
 */
interface ConnectionStatistics {

  /**
   * 本端与 RTC 服务的往返时延，单位 ms。
   */
  rttMs?: number;

  /**
   * 连接级上下行丢包率，单位 %。
   */
  uplinkLossPercent?: number;
  downlinkLossPercent?: number;

  /**
   * 当前连接累计收发的字节数。
   */
  sentBytes?: number;
  receivedBytes?: number;
}

/**
 * 网络质量日志可附带厂商实际提供的独立方向指标，不由整体 RTT 推算。
 */
interface NetworkQualityStatistics extends RealtimeNetworkQuality {

  /**
   * 独立上下行往返时延，单位 ms。
   */
  uplinkRTT?: number;
  downlinkRTT?: number;

  /**
   * 独立上下行丢包率，单位 %。
   */
  uplinkLoss?: number;
  downlinkLoss?: number;
}

/**
 * 使用公共统计对象输出厂商无关的性能日志，视频字段顺序和单位与 iOS 一致。 @internal
 */
export class RtcStatsLogger {

  /**
   * 输出上行视频统计；保持 info 级别，关闭性能日志时不格式化。
   */
  static logUplinkVideoStatistics(
    video: UplinkVideoStatistics,
  ): void {
    XmaxLogger.rtc.info(() => this.uplinkVideoStatisticsMessage(video), XmaxLoggerOption.performance);
  }

  /**
   * 格式化上行视频指标，不以发送帧率填补缺失的编码帧率。
   */
  static uplinkVideoStatisticsMessage(
    video: UplinkVideoStatistics,
  ): string {
    return this.block("视频上行统计 (Video Uplink Statistics)", [
      `${XmaxLogger.localized("分辨率：", "Resolution: ")}${this.resolution(video.width, video.height)}`,
      `${XmaxLogger.localized("发送码率：", "Send Bitrate: ")}${this.value(video.bitrateKbps, "kbps")}`,
      `${XmaxLogger.localized("采集帧率：", "Capture Frame Rate: ")}${this.value(video.captureFrameRate, "fps")}`,
      `${XmaxLogger.localized("编码帧率：", "Encode Frame Rate: ")}${this.value(video.encodeFrameRate, "fps")}`,
      `${XmaxLogger.localized("发送帧率：", "Send Frame Rate: ")}${this.value(video.sendFrameRate, "fps")}`,
      `${XmaxLogger.localized("视频丢包率：", "Video Packet Loss: ")}${this.value(video.packetLossPercent, "%")}`,
    ]);
  }

  /**
   * 输出下行视频统计，采用与统计回调相同的对象。
   */
  static logDownlinkVideoStatistics(
    video: DownlinkVideoStatistics,
  ): void {
    XmaxLogger.rtc.info(() => this.downlinkVideoStatisticsMessage(video), XmaxLoggerOption.performance);
  }

  /**
   * 格式化下行视频指标；不输出用户标识或未经白名单筛选的厂商字段。
   */
  static downlinkVideoStatisticsMessage(
    video: DownlinkVideoStatistics,
  ): string {
    return this.block("视频下行统计 (Video Downlink Statistics)", [
      `${XmaxLogger.localized("分辨率：", "Resolution: ")}${this.resolution(video.width, video.height)}`,
      `${XmaxLogger.localized("接收码率：", "Receive Bitrate: ")}${this.value(video.bitrateKbps, "kbps")}`,
      `${XmaxLogger.localized("解码帧率：", "Decode Frame Rate: ")}${this.value(video.decodeFrameRate, "fps")}`,
      `${XmaxLogger.localized("渲染帧率：", "Render Frame Rate: ")}${this.value(video.renderFrameRate, "fps")}`,
      `${XmaxLogger.localized("视频丢包率：", "Video Packet Loss: ")}${this.value(video.packetLossPercent, "%")}`,
      `${XmaxLogger.localized("端到端时延：", "End-to-End Delay: ")}${this.value(video.endToEndDelayMs, "ms")}`,
    ]);
  }

  /**
   * 独立保留连接级 RTT、丢包率和累计流量，不混入视频指标。
   */
  static logConnectionStatistics(
    stats: ConnectionStatistics,
  ): void {
    XmaxLogger.rtc.info(() => this.block("RTC 运行统计 (RTC Statistics)", [
      `RTT: ${this.value(stats.rttMs, "ms")}`,
      `${XmaxLogger.localized("上行丢包率：", "Uplink Packet Loss: ")}${this.value(stats.uplinkLossPercent, "%")}`,
      `${XmaxLogger.localized("下行丢包率：", "Downlink Packet Loss: ")}${this.value(stats.downlinkLossPercent, "%")}`,
      `${XmaxLogger.localized("累计发送：", "Bytes Sent: ")}${this.value(stats.sentBytes, "bytes")}`,
      `${XmaxLogger.localized("累计接收：", "Bytes Received: ")}${this.value(stats.receivedBytes, "bytes")}`,
    ]), XmaxLoggerOption.performance);
  }

  /**
   * 输出统一网络质量；仅附带厂商实际提供的独立方向时延和丢包率。
   */
  static logNetworkQuality(
    stats: NetworkQualityStatistics,
  ): void {
    XmaxLogger.rtc.info(() => {
      const details = (rtt?: number, loss?: number) => rtt === undefined && loss === undefined
        ? ""
        : `, RTT ${this.value(rtt, "ms")}, ${XmaxLogger.localized("丢包率 ", "Loss ")}${this.value(loss, "%")}`;
      return this.block("网络质量 (Network Quality Metrics)", [
        `${XmaxLogger.localized("本地上行：", "Local Uplink: ")}${this.quality(stats.uplink)}${details(stats.uplinkRTT, stats.uplinkLoss)}`,
        `${XmaxLogger.localized("本地下行（平均）：", "Local Downlink (Average): ")}${this.quality(stats.downlink)}${details(stats.downlinkRTT, stats.downlinkLoss)}`,
      ]);
    }, XmaxLoggerOption.performance);
  }

  /**
   * 宽高必须同时有效，任意一项缺失时整个分辨率显示占位符。
   */
  private static resolution(
    width?: number,
    height?: number,
  ): string {
    if (typeof width !== "number" || typeof height !== "number" || !Number.isFinite(width) || !Number.isFinite(height) || width <= 0 || height <= 0) {
      return "—";
    }
    return `${width} × ${height}`;
  }

  /**
   * 为指标列表添加标题和树形行前缀，生成一个控制台日志分组。
   */
  private static block(
    title: string,
    lines: string[]
  ): string {
    return [title, ...lines.map((line, index) => `${index === lines.length - 1 ? "└─" : "├─"} ${line}`)].join("\n");
  }

  /**
   * 不改变公共单位，保留有效零值，Web 小数最多显示两位。
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
   * 将公共网络质量枚举转换为本地化文案。
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
    return XmaxLogger.localized(name[0], name[1]);
  }
}
