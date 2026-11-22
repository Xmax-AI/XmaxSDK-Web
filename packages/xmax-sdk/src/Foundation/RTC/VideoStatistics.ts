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
 * Shared uplink/downlink media metrics. Missing or invalid metrics are undefined.
 */
interface VideoStatistics {

  /**
   * The actual width, in pixels: sent dimensions locally and received dimensions remotely.
   */
  readonly width?: number;

  /**
   * The actual height, in pixels: sent dimensions locally and received dimensions remotely.
   */
  readonly height?: number;

  /**
   * The actual bitrate, in kbps.
   */
  readonly bitrateKbps?: number;
}

/**
 * Runtime statistics for local outgoing video. Each frame rate describes a separate stage.
 * Unavailable frame rates are undefined, and a reported zero is valid.
 */
export interface UplinkVideoStatistics extends VideoStatistics {

  /**
   * The actual capture frame rate, in fps.
   */
  readonly captureFrameRate?: number;

  /**
   * The number of output frames produced by the encoder per second.
   */
  readonly encodeFrameRate?: number;

  /**
   * The number of video frames sent by the RTC transport per second.
   */
  readonly sendFrameRate?: number;

  /**
   * The local-to-RTC-cloud uplink video loss, from 0 to 100 percent.
   */
  readonly packetLossPercent?: number;
}

/**
 * Receives uplink snapshots; undefined means unpublished, stopped, or disconnected media.
 */
export type UplinkVideoStatisticsListener = (
  statistics: UplinkVideoStatistics | undefined
) => void;

/**
 * Reception statistics for one remote main-video stream.
 */
export interface DownlinkVideoStatistics extends VideoStatistics {

  /**
   * The RTC user ID.
   */
  readonly userID: string;

  /**
   * The actual decoding frame rate, in fps.
   */
  readonly decodeFrameRate?: number;

  /**
   * The RTC rendering frame rate, in fps.
   */
  readonly renderFrameRate?: number;

  /**
   * The RTC-cloud-to-local downlink video loss, from 0 to 100 percent.
   */
  readonly packetLossPercent?: number;

  /**
   * The provider's estimated media E2E delay, in milliseconds, not the complete AI processing latency.
   * Agora end2EndDelay excludes encoding and decoding time.
   */
  readonly endToEndDelayMs?: number;
}

/**
 * Receives downlink snapshots; undefined means the result stream has no statistics or was cleared.
 */
export type DownlinkVideoStatisticsListener = (
  statistics: DownlinkVideoStatistics | undefined
) => void;
