//
//  EncodingBitratePolicy.ts
//  XmaxSDK
//
//  Author: 翁跃庭 (Yueting Weng)
//  GitHub: https://github.com/Xmax-AI/XmaxSDK-Web
//
//  Copyright (c) 2026 XMAX.AI PTE. LTD.
//

import { XmaxError, XmaxErrorCode } from "../../Foundation/Errors/XmaxError";
import { RealtimeVideoFormat } from "../../Service/Realtime/RealtimeVideoFormat";

/**
 * A pixel-area or frame-rate reference point with bitrate in kbps.
 */
interface BitratePoint {

  /**
   * The pixel-area or frame-rate boundary.
   */
  value: number;

  /**
   * The reference bitrate at this boundary, in kbps.
   */
  bitrate: number;
}

/**
 * A shared default bitrate budget for uplink and downlink; explicit uplink bounds are handled by the
 * encoding controller.
 */
export class EncodingBitratePolicy {

  /**
   * The maximum-bitrate multiplier applied to reference values.
   */
  private static readonly bitrateScale = 0.6;

  /**
   * Resolves a fixed 100 kbps minimum and a size/frame-rate-dependent maximum multiplied by the budget
   * scale.
   */
  static resolve(
    width: number,
    height: number,
    fps: number
  ): {
    minimum: number;
    maximum: number
  } {
    new RealtimeVideoFormat({
      width,
      height,
      fps
    }).validate();
    const maximum = Math.round(
      this.resolveMaximumBitrate(
        width * height,
        fps
      ) * this.bitrateScale,
    );
    if (!Number.isSafeInteger(maximum)) {
      throw new XmaxError(
        XmaxErrorCode.invalidConfiguration,
        "Realtime video format exceeds the supported bitrate range",
      );
    }

    return {
      minimum: 100,
      maximum: Math.max(100, maximum)
    };
  }

  /**
   * Interpolates maximum reference bitrate from pixel area and frame rate.
   */
  private static resolveMaximumBitrate(
    pixels: number,
    fps: number
  ): number {
    const bitrate15 = EncodingBitratePolicy.interpolate(
      pixels,
      EncodingBitratePolicy.referenceBitratesAt15FPS,
    );

    const first30 = EncodingBitratePolicy.referenceBitratesAt30FPS[0]!;
    let bitrate30: number;
    if (pixels < first30.value) {
      // Use the 15 fps size curve for small inputs to connect to the first 30 fps reference point.
      const reference15 = EncodingBitratePolicy.interpolate(
        first30.value,
        EncodingBitratePolicy.referenceBitratesAt15FPS,
      );
      bitrate30 = bitrate15 * (first30.bitrate / reference15);
    } else {
      bitrate30 = EncodingBitratePolicy.interpolate(
        pixels,
        EncodingBitratePolicy.referenceBitratesAt30FPS,
      );
    }

    // Scale the 15 fps size curve to the 640×480, 400 kbps reference at 10 fps.
    const bitrate10 = bitrate15 * (400 / 500);

    // Scale the 30 fps size curve to the quality-oriented 1080p reference at 60 fps.
    const maximum60 = bitrate30 * (6500 / 3150);

    return EncodingBitratePolicy.interpolate(
      fps,
      [
        {
          value: 10,
          bitrate: bitrate10 * 2
        },
        {
          value: 15,
          bitrate: bitrate15 * 2
        },
        {
          value: 30,
          bitrate: bitrate30 * 2
        },
        {
          value: 60,
          bitrate: maximum60
        },
      ]
    );
  }

  /**
   * Interpolates between adjacent points and extrapolates proportionally beyond the nearest endpoint.
   */
  private static interpolate(
    value: number,
    points: BitratePoint[]
  ): number {
    const first = points[0]!;
    if (value <= first.value) {
      return first.bitrate * (value / first.value);
    }

    for (let index = 1; index < points.length; index += 1) {
      const upper = points[index]!;
      if (value <= upper.value) {
        const lower = points[index - 1]!;
        const ratio = (value - lower.value) / (upper.value - lower.value);
        return lower.bitrate + (upper.bitrate - lower.bitrate) * ratio;
      }
    }

    const last = points[points.length - 1]!;
    return last.bitrate * (value / last.value);
  }

  /**
   * Smoothness-oriented reference bitrates sorted by pixel area, in kbps.
   */
  private static readonly referenceBitratesAt15FPS: BitratePoint[] = [
    {
      value: 120 * 120,
      bitrate: 50
    },
    {
      value: 160 * 120,
      bitrate: 65
    },
    {
      value: 180 * 180,
      bitrate: 100
    },
    {
      value: 240 * 180,
      bitrate: 120
    },
    {
      value: 320 * 180,
      bitrate: 140
    },
    {
      value: 320 * 240,
      bitrate: 200
    },
    {
      value: 424 * 240,
      bitrate: 220
    },
    {
      value: 360 * 360,
      bitrate: 260
    },
    {
      value: 480 * 360,
      bitrate: 320
    },
    {
      value: 640 * 360,
      bitrate: 400
    },
    {
      value: 640 * 480,
      bitrate: 500
    },
    {
      value: 848 * 480,
      bitrate: 610
    },
    {
      value: 960 * 720,
      bitrate: 910
    },
    {
      value: 1280 * 720,
      bitrate: 1130
    },
    {
      value: 1920 * 1080,
      bitrate: 2080
    },
  ];

  /**
   * Reference bitrates at 30 fps indexed by pixel area, in kbps.
   */
  private static readonly referenceBitratesAt30FPS: BitratePoint[] = [
    {
      value: 360 * 360,
      bitrate: 400
    },
    {
      value: 480 * 360,
      bitrate: 490
    },
    {
      value: 640 * 360,
      bitrate: 600
    },
    {
      value: 640 * 480,
      bitrate: 750
    },
    {
      value: 848 * 480,
      bitrate: 930
    },
    {
      value: 960 * 720,
      bitrate: 1380
    },
    {
      value: 1280 * 720,
      bitrate: 1710
    },
    {
      value: 1920 * 1080,
      bitrate: 3150
    },
  ];
}
