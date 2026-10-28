//
//  RealtimeVideoFormat.ts
//  XmaxSDK
//
//  Author: 翁跃庭 (Yueting Weng)
//  GitHub: https://github.com/Xmax-AI/XmaxSDK-Web
//
//  Copyright (c) 2026 XMAX.AI PTE. LTD.
//

import { XmaxError, XmaxErrorCode } from "../../Foundation/Errors/XmaxError";

/**
 * Encoding preferences for realtime video.
 */
export enum RealtimeVideoEncoderPreference {

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
 * Video dimensions, frame rate, and uplink encoding options.
 */
export interface RealtimeVideoFormatInit {

  /**
   * The video width, in pixels.
   */
  width: number;

  /**
   * The video height, in pixels.
   */
  height: number;

  /**
   * The video frame rate, which must be positive.
   */
  fps: number;

  /**
   * The minimum uplink bitrate, in kbps; defaults to the lower of 500 and the maximum bitrate. Zero
   * disables the lower bound.
   */
  minimumBitrate?: number;

  /**
   * The maximum uplink bitrate, in kbps; must be positive when supplied. Omission uses the SDK default.
   */
  maximumBitrate?: number;

  /**
   * The uplink encoding preference; defaults to maintaining frame rate.
   */
  encoderPreference?: RealtimeVideoEncoderPreference;
}

/**
 * The dimensions, frame rate, and uplink encoding configuration for realtime video.
 */
export class RealtimeVideoFormat {

  /**
   * The video width, in pixels.
   */
  readonly width: number;

  /**
   * The video height, in pixels.
   */
  readonly height: number;

  /**
   * The video frame rate, in fps.
   */
  readonly fps: number;

  /**
   * The minimum uplink bitrate, in kbps, for providers that support it. Defaults to the lower of 500 and
   * the maximum bitrate; zero disables the lower bound.
   */
  readonly minimumBitrate?: number;

  /**
   * The maximum uplink bitrate, in kbps; calculated by XmaxSDK when omitted.
   */
  readonly maximumBitrate?: number;

  /**
   * The preference for retaining frame rate or resolution on constrained networks.
   */
  readonly encoderPreference: RealtimeVideoEncoderPreference;

  /**
   * Creates a realtime video format.
   */
  constructor(
    init: RealtimeVideoFormatInit
  ) {
    this.width = init.width;
    this.height = init.height;
    this.fps = init.fps;

    this.minimumBitrate = init.minimumBitrate;
    this.maximumBitrate = init.maximumBitrate;
    this.encoderPreference =
      init.encoderPreference ?? RealtimeVideoEncoderPreference.maintainFramerate;
  }

  /**
   * Validates dimensions, frame rate, and explicit bitrate bounds.
   *
   * @throws An error if the dimensions, frame rate, or bitrate configuration is invalid.
   */
  validate(): void {
    if (
      this.width <= 0 ||
      this.height <= 0 ||
      !Number.isFinite(this.fps) ||
      this.fps <= 0 ||
      this.width % 2 !== 0 ||
      this.height % 2 !== 0
    ) {
      throw new XmaxError(
        XmaxErrorCode.invalidConfiguration,
        "Realtime video width and height must be positive " +
        "even numbers, and fps must be greater than zero",
      );
    }

    if (this.minimumBitrate !== undefined && (!Number.isFinite(this.minimumBitrate) || this.minimumBitrate < 0)) {
      throw new XmaxError(
        XmaxErrorCode.invalidConfiguration,
        "Minimum bitrate must be finite and not negative",
      );
    }
    if (this.maximumBitrate !== undefined && (!Number.isFinite(this.maximumBitrate) || this.maximumBitrate <= 0)) {
      throw new XmaxError(
        XmaxErrorCode.invalidConfiguration,
        "Maximum bitrate must be finite and greater than zero",
      );
    }

    if (
      this.minimumBitrate !== undefined &&
      this.maximumBitrate !== undefined &&
      this.minimumBitrate > this.maximumBitrate
    ) {
      throw new XmaxError(
        XmaxErrorCode.invalidConfiguration,
        "Minimum bitrate must not exceed maximum bitrate",
      );
    }
  }

  /**
   * Returns a resized format, preserving frame rate and uplink encoding options.
   */
  resized(
    width: number,
    height: number
  ): RealtimeVideoFormat {
    return new RealtimeVideoFormat({
      width,
      height,
      fps: this.fps,
      minimumBitrate: this.minimumBitrate,
      maximumBitrate: this.maximumBitrate,
      encoderPreference: this.encoderPreference,
    });
  }
}
