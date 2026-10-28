//
//  AgoraVideoSender.ts
//  XmaxSDK
//
//  Author: 翁跃庭 (Yueting Weng)
//  GitHub: https://github.com/Xmax-AI/XmaxSDK-Web
//
//  Copyright (c) 2026 XMAX.AI PTE. LTD.
//

import type { ILocalVideoTrack } from "agora-rtc-sdk-ng";
import { XmaxError, XmaxErrorCode } from "../../Errors/XmaxError";
import { RtcVideoEncoderPreference, type VideoEncodingConfiguration } from "../VideoEncodingConfiguration";

/**
 * Experimental camera-sender configuration without changing capture constraints or calling Agora encoder
 * configuration.
 */
export class AgoraVideoSender {

  /**
   * Applies bitrate and frame-rate limits to the browser video sender.
   */
  static async apply(
    track: ILocalVideoTrack,
    config: VideoEncodingConfiguration,
    ensureActive: () => void
  ): Promise<void> {
    ensureActive();
    const sender = track.getRTCRtpTransceiver()?.sender;
    if (!sender) {
      throw new XmaxError(
        XmaxErrorCode.rtcError,
        "WebRTC video sender is unavailable"
      );
    }
    const capture = sender.track?.getSettings();
    if (!capture?.width || !capture.height) {
      throw new XmaxError(
        XmaxErrorCode.rtcError,
        "WebRTC capture dimensions are unavailable"
      );
    }
    // Derive scaling from capture dimensions, not the previous send dimensions, to avoid repeated scaling across downgrades.
    const scale = Math.max(1, capture.width / config.width, capture.height / config.height);
    const parameters = sender.getParameters();
    if (parameters.encodings?.length !== 1) {
      throw new XmaxError(
        XmaxErrorCode.rtcError,
        "Sender-only configuration requires one video encoding"
      );
    }
    const encoding = parameters.encodings[0]!;
    const previous = { ...encoding };
    const previousPreference = parameters.degradationPreference;
    encoding.scaleResolutionDownBy = scale;
    encoding.maxFramerate = config.frameRate;
    encoding.maxBitrate = Math.round(config.maximumBitrate * 1000);
    parameters.degradationPreference = config.encoderPreference === RtcVideoEncoderPreference.maintainFramerate
      ? "maintain-framerate" : "maintain-resolution";
    await sender.setParameters(parameters);
    ensureActive();
    if (track.getRTCRtpTransceiver()?.sender !== sender) {
      throw new XmaxError(
        XmaxErrorCode.cancelled,
        "WebRTC video sender changed during configuration"
      );
    }
    const applied = sender.getParameters();
    const actual = applied.encodings?.[0];
    if (!actual || Math.abs((actual.scaleResolutionDownBy ?? 1) - scale) > 0.0001 ||
      actual.maxFramerate !== encoding.maxFramerate || actual.maxBitrate !== encoding.maxBitrate) {
      // Browsers may silently ignore fields; attempt to restore sender parameters without
      // falling back to capture-constraint changes.
      if (actual && applied.encodings.length === 1) {
        for (const key of ["scaleResolutionDownBy", "maxFramerate", "maxBitrate"] as const) {
          if (previous[key] === undefined) {
            delete actual[key];
          }
          else {
            actual[key] = previous[key];
          }
        }
        if (previousPreference === undefined) {
          delete applied.degradationPreference;
        }
        else {
          applied.degradationPreference = previousPreference;
        }
        await sender.setParameters(applied);
      }
      throw new XmaxError(
        XmaxErrorCode.rtcError,
        "Browser did not retain WebRTC video sender parameters"
      );
    }
  }
}
