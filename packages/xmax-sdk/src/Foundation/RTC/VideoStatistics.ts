//
//  VideoStatistics.ts
//  XmaxSDK
//
//  Author: 翁跃庭 (Yueting Weng)
//  GitHub: https://github.com/Xmax-AI/XmaxSDK-Web
//
//  Copyright (c) 2026 XMAX.AI PTE. LTD.
//

/**
 * 上下行视频统计共用的媒体指标；缺失或无效指标为 undefined。
 */
interface VideoStatistics {

  /**
   * 视频实际宽度，单位为像素；本地为发送尺寸，远端为接收尺寸。
   */
  readonly width?: number;

  /**
   * 视频实际高度，单位为像素；本地为发送尺寸，远端为接收尺寸。
   */
  readonly height?: number;

  /**
   * 实际码率，单位 kbps。
   */
  readonly bitrateKbps?: number;
}

/**
 * 本地视频流的上行运行统计。
 */
export interface UplinkVideoStatistics extends VideoStatistics {

  /**
   * 实际采集帧率，单位 fps。
   */
  readonly captureFrameRate?: number;

  /**
   * 实际编码帧率，单位 fps；厂商未提供时为空，不以发送帧率替代。
   */
  readonly encodeFrameRate?: number;

  /**
   * 实际发送帧率，单位 fps。
   */
  readonly sendFrameRate?: number;

  /**
   * 本端到 RTC 云端的视频上行丢包率，范围为 0～100，单位 %。
   */
  readonly packetLossPercent?: number;
}

/**
 * undefined 表示当前没有可用统计（尚未发布、断开或停止）。
 */
export type UplinkVideoStatisticsListener = (
  statistics: UplinkVideoStatistics | undefined
) => void;

/**
 * 一路远端主视频流的接收统计。
 */
export interface DownlinkVideoStatistics extends VideoStatistics {

  /**
   * RTC 用户标识。
   */
  readonly userID: string;

  /**
   * 实际解码帧率，单位 fps。
   */
  readonly decodeFrameRate?: number;

  /**
   * RTC 渲染帧率，单位 fps。
   */
  readonly renderFrameRate?: number;

  /**
   * RTC 云端到本端 SDK 的视频下行丢包率，范围为 0～100，单位 %。
   */
  readonly packetLossPercent?: number;

  /**
   * RTC 媒体端到端延迟估算值，单位 ms；不代表完整 AI 处理链路耗时。
   * 采用各厂商原生口径，Agora end2EndDelay 不包含编码与解码耗时。
   */
  readonly endToEndDelayMs?: number;
}

/**
 * undefined 表示当前结果流没有统计或已被清理。
 */
export type DownlinkVideoStatisticsListener = (
  statistics: DownlinkVideoStatistics | undefined
) => void;
