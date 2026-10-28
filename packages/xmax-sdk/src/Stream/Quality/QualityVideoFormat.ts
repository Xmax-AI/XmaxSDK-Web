//
//  QualityVideoFormat.ts
//  XmaxSDK
//
//  Author: 翁跃庭 (Yueting Weng)
//  GitHub: https://github.com/Xmax-AI/XmaxSDK-Web
//
//  Copyright (c) 2026 XMAX.AI PTE. LTD.
//

import { RealtimeVideoFormat } from "../../Service/Realtime/RealtimeVideoFormat";
import { EncodingBitratePolicy } from "../Encoding/EncodingBitratePolicy";
import { MINIMUM_QUALITY_SHORT_SIDE, QUALITY_TIERS } from "./QualityTiers";
import { alignedVideoSize } from "../../Foundation/Media/Video/VideoSize";
import { XmaxError, XmaxErrorCode } from "../../Foundation/Errors/XmaxError";

/**
 * Computes floating-point dimension bounds; media or encoding rules perform final alignment.
 */
export function qualityVideoMaximumSize(
  baseline: RealtimeVideoFormat,
  level: number
): {
  width: number;
  height: number
} {
  const tier = Object.values(QUALITY_TIERS)[level - 1];
  if (!Number.isInteger(level) || !tier) {
    throw new Error("Unsupported quality level");
  }
  baseline.validate();
  const shortSide = Math.min(baseline.width, baseline.height);
  const minimum = Math.min(shortSide, MINIMUM_QUALITY_SHORT_SIDE);
  const scale = Math.max(tier.scale, minimum / shortSide);
  return {
    width: baseline.width * scale,
    height: baseline.height * scale
  };
}

/**
 * Computes four-pixel-aligned uplink dimensions, preferring the exact aspect ratio with
 * independent-rounding fallback.
 */
export function qualityVideoSize(
  baseline: RealtimeVideoFormat,
  level: number,
  preserveAspectRatio = true,
): {
  width: number;
  height: number
} {
  const maximum = qualityVideoMaximumSize(
    baseline,
    level
  );
  if (preserveAspectRatio) {
    return alignedVideoSize(
      baseline,
      Math.min(1, maximum.width / baseline.width, maximum.height / baseline.height),
      4
    );
  }

  const width = Math.floor(maximum.width / 4 + 1e-9) * 4;
  const height = Math.floor(maximum.height / 4 + 1e-9) * 4;
  if (width < 4 || height < 4) {
    throw new XmaxError(
      XmaxErrorCode.invalidConfiguration,
      "No aligned video size is available within the size limits"
    );
  }
  return {
    width,
    height
  };
}

/**
 * Checks whether default target bitrates are compatible with explicit uplink bounds.
 */
export function supportsQualityEncoding(
  format: RealtimeVideoFormat
): boolean {
  const defaults = EncodingBitratePolicy.resolve(
    format.width,
    format.height,
    format.fps
  );
  const maximum = format.maximumBitrate ?? defaults.maximum;
  return (format.minimumBitrate ?? Math.min(500, maximum)) <= maximum;
}

/**
 * Derives aligned quality formats from the initial or manually selected L1 baseline. Does not use actual
 * RTC send statistics, preserving the recovery ceiling. Explicit bitrate bounds remain unchanged;
 * omitted bounds are resolved by the encoding layer.
 */
export function qualityVideoFormat(
  baseline: RealtimeVideoFormat,
  level: number,
  preserveAspectRatio = true
): RealtimeVideoFormat {
  const size = qualityVideoSize(
    baseline,
    level,
    preserveAspectRatio
  );
  const tier = Object.values(QUALITY_TIERS)[level - 1]!;
  return new RealtimeVideoFormat({
    ...baseline,
    ...size,
    fps: Math.min(baseline.fps, tier.frameRate),
  });
}
