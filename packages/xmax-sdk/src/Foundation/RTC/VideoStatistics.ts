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
 * 视频流实际运行统计；缺失或无效指标为 undefined。
 */
export interface VideoStatistics {

  /**
   * 本端到 RTC 云端的视频上行丢包率，单位为 %。
   */
  readonly uplinkLossPercent?: number;

  /**
   * 视频实际宽度，单位为像素；本地为发送尺寸，远端为接收尺寸。
   */
  readonly width?: number;

  /**
   * 视频实际高度，单位为像素；本地为发送尺寸，远端为接收尺寸。
   */
  readonly height?: number;

  /**
   * 实际帧率，单位 fps。
   */
  readonly frameRate?: number;

  /**
   * 实际码率，单位 kbps。
   */
  readonly bitrateKbps?: number;

  /**
   * 本端到 RTC 云端的往返延迟，单位 ms；本地统计对应发送链路，远端统计对应接收链路。
   * 仅保留厂商提供的测量值，未提供时为空。
   */
  readonly rttMs?: number;
}

/**
 * undefined 表示当前没有可用统计（尚未发布、断开或停止）。
 */
export type VideoStatisticsListener = (
  statistics: VideoStatistics | undefined
) => void;

/**
 * 一路远端主视频流的接收统计。
 */
export interface RemoteVideoStatistics extends VideoStatistics {

  /**
   * RTC 用户标识。
   */
  readonly userID: string;

  /**
   * 本端 SDK 到 RTC 云端的往返延迟，单位 ms；不是与远端用户之间的 RTT。
   */
  readonly rttMs?: number;

  /**
   * 本端 SDK 到 RTC 云端的上行丢包率，单位 %，不是结果流的发送端丢包率。
   */
  readonly uplinkLossPercent?: number;

  /**
   * RTC 云端到本端 SDK 的下行丢包率，单位 %。
   */
  readonly downlinkLossPercent?: number;

  /**
   * 当前远端视频流的播放缓冲延迟，单位 ms；Agora 未提供时为空。
   */
  readonly jitterBufferDelayMs?: number;

  /**
   * RTC 媒体端到端延迟估算值，单位 ms；不代表完整 AI 处理链路耗时。
   * 采用各厂商原生口径，Agora end2EndDelay 不包含编码与解码耗时。
   */
  readonly endToEndDelayMs?: number;
}

/**
 * undefined 表示当前结果流没有统计或已被清理。
 */
export type RemoteVideoStatisticsListener = (
  statistics: RemoteVideoStatistics | undefined
) => void;
