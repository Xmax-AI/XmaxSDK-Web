//
//  EncodingController.ts
//  XmaxSDK
//
//  Author: 翁跃庭 (Yueting Weng)
//  GitHub: https://github.com/Xmax-AI/XmaxSDK-Web
//
//  Copyright (c) 2026 XMAX.AI PTE. LTD.
//

import { XmaxError, XmaxErrorCode } from "../../Foundation/Errors/XmaxError";
import type { RtcManaging } from "../../Foundation/RTC/RtcManaging";
import {
  RtcVideoEncoderPreference,
  type VideoEncodingConfiguration,
} from "../../Foundation/RTC/VideoEncodingConfiguration";
import {
  RealtimeVideoEncoderPreference,
  RealtimeVideoFormat,
} from "../../Service/Realtime/RealtimeVideoFormat";
import { EncodingBitratePolicy } from "./EncodingBitratePolicy";
import type { EncodingControlling } from "./EncodingControlling";

/**
 * The mapping from public encoding preferences to RTC preferences.
 */
const ENCODER_PREFERENCE_MAP: Record<
  RealtimeVideoEncoderPreference,
  RtcVideoEncoderPreference
> = {
    [RealtimeVideoEncoderPreference.maintainFramerate]:
      RtcVideoEncoderPreference.maintainFramerate,
    [RealtimeVideoEncoderPreference.maintainQuality]:
      RtcVideoEncoderPreference.maintainQuality,
  };

/**
 * Configures RTC encoding from a realtime video format.
 *
 * The default minimum is the lower of 500 kbps and the resolved maximum. The shared budget computes the
 * maximum unless explicit format bounds override defaults.
 */
export class EncodingController implements EncodingControlling {

  /**
   * The RTC adapter receiving encoding settings.
   */
  private readonly rtcManager: RtcManaging;

  /**
   * The last encoding settings successfully applied to RTC.
   */
  private lastAppliedConfiguration?: VideoEncodingConfiguration;

  /**
   * Creates an encoding controller.
   */
  constructor(
    options: {
      rtcManager: RtcManaging
    }
  ) {
    this.rtcManager = options.rtcManager;
  }

  /**
   * Validates the format, resolves explicit or default bitrate bounds, and configures RTC.
   */
  async configure(
    videoFormat: RealtimeVideoFormat
  ): Promise<void> {
    videoFormat.validate();

    let minimum: number;
    let maximum: number;
    if (
      videoFormat.minimumBitrate !== undefined &&
      videoFormat.maximumBitrate !== undefined
    ) {
      minimum = videoFormat.minimumBitrate;
      maximum = videoFormat.maximumBitrate;
    } else {
      const defaults = EncodingBitratePolicy.resolve(
        videoFormat.width,
        videoFormat.height,
        videoFormat.fps,
      );
      maximum = videoFormat.maximumBitrate ?? defaults.maximum;
      minimum = videoFormat.minimumBitrate ?? Math.min(500, maximum);
    }

    if (minimum > maximum) {
      throw new XmaxError(
        XmaxErrorCode.invalidConfiguration,
        "Minimum bitrate must not exceed maximum bitrate after applying SDK defaults",
      );
    }

    const configuration: VideoEncodingConfiguration = {
      width: videoFormat.width,
      height: videoFormat.height,
      frameRate: videoFormat.fps,
      minimumBitrate: minimum,
      maximumBitrate: maximum,
      encoderPreference: ENCODER_PREFERENCE_MAP[videoFormat.encoderPreference],
    };
    await this.rtcManager.configureVideoEncoding(configuration);
    this.lastAppliedConfiguration = { ...configuration };
  }

  /**
   * Replaces only frame rate while retaining the last successful dimensions, resolved bitrate range, and
   * preference.
   */
  async updateFrameRate(
    fps: number
  ): Promise<RealtimeVideoFormat> {
    const previous = this.lastAppliedConfiguration;
    if (!previous) {
      throw new XmaxError(
        XmaxErrorCode.invalidConfiguration,
        "Apply an encoder configuration before updating frame rate"
      );
    }
    const format = new RealtimeVideoFormat({
      width: previous.width,
      height: previous.height,
      fps,
      minimumBitrate: previous.minimumBitrate,
      maximumBitrate: previous.maximumBitrate,
      encoderPreference: previous.encoderPreference === RtcVideoEncoderPreference.maintainFramerate
        ? RealtimeVideoEncoderPreference.maintainFramerate : RealtimeVideoEncoderPreference.maintainQuality,
    });
    format.validate();
    if (fps !== previous.frameRate) {
      const next = {
        ...previous,
        frameRate: fps
      };
      await this.rtcManager.configureVideoEncoding(next);
      this.lastAppliedConfiguration = next;
    }
    return format;
  }
}
