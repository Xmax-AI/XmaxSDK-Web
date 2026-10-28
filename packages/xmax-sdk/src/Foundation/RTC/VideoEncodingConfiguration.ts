//
//  VideoEncodingConfiguration.ts
//  XmaxSDK
//
//  Author: 翁跃庭 (Yueting Weng)
//  GitHub: https://github.com/Xmax-AI/XmaxSDK-Web
//
//  Copyright (c) 2026 XMAX.AI PTE. LTD.
//

/**
 * RTC video encoding preferences.
 */
export enum RtcVideoEncoderPreference {

  /**
   * Prioritizes frame rate by reducing resolution on constrained networks.
   */
  maintainFramerate = "maintainFramerate",

  /**
   * Prioritizes resolution by reducing frame rate on constrained networks.
   */
  maintainQuality = "maintainQuality",
}

/**
 * Video encoding settings supplied to an RTC engine. TRTC accepts one target bitrate, taken from
 * minimumBitrate. Its maximumBitrate validates the range but is not sent to the engine.
 */
export interface VideoEncodingConfiguration {

  /**
   * The encoding width, in pixels.
   */
  width: number;

  /**
   * The encoding height, in pixels.
   */
  height: number;

  /**
   * The encoding frame rate.
   */
  frameRate: number;

  /**
   * The minimum uplink bitrate, in kbps: TRTC's target, Agora's lower bound, and unsupported as a bound
   * by VeRTC.
   */
  minimumBitrate: number;

  /**
   * The maximum uplink bitrate, in kbps: an Agora/VeRTC limit and only a range check for TRTC.
   */
  maximumBitrate: number;

  /**
   * The encoding preference.
   */
  encoderPreference: RtcVideoEncoderPreference;
}
