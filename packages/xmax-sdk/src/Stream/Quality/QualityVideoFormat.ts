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

/**
 * 计算档位的浮点尺寸上限；最终对齐由媒体或编码尺寸规则完成。
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
  return { width: baseline.width * scale, height: baseline.height * scale };
}

/**
 * 计算上行偶数对齐尺寸；优先保持精确比例，外部轨道可按宽高分别取整。
 */
export function qualityVideoSize(
  baseline: RealtimeVideoFormat,
  level: number,
  preserveAspectRatio = true,
): {
  width: number;
  height: number
} {
  const maximum = qualityVideoMaximumSize(baseline, level);
  if (preserveAspectRatio) {
    return alignedVideoSize(baseline, Math.min(1, maximum.width / baseline.width, maximum.height / baseline.height), 2);
  }

  const even = (value: number) => Math.max(2, Math.floor(value / 2 + 1e-9) * 2);
  return { width: even(maximum.width), height: even(maximum.height) };
}

/**
 * 检查目标规格的默认码率与显式上传码率约束是否兼容。
 */
export function supportsQualityEncoding(
  format: RealtimeVideoFormat
): boolean {
  const defaults = EncodingBitratePolicy.resolve(format.width, format.height, format.fps);
  const maximum = format.maximumBitrate ?? defaults.maximum;
  return (format.minimumBitrate ?? Math.min(500, maximum)) <= maximum;
}

/**
 * 以用户初始/手动配置为 L1，按统一比例缩小并对齐。
 * 不读取 RTC 实际发送统计，避免自动降档后丢失恢复上限。
 * 显式码率沿用用户约束；缺省码率保持 undefined，由编码层按目标尺寸和帧率解析。
 */
export function qualityVideoFormat(
  baseline: RealtimeVideoFormat,
  level: number,
  preserveAspectRatio = true
): RealtimeVideoFormat {
  const size = qualityVideoSize(baseline, level, preserveAspectRatio);
  const tier = Object.values(QUALITY_TIERS)[level - 1]!;
  return new RealtimeVideoFormat({
    ...baseline,
    ...size,
    fps: Math.min(baseline.fps, tier.frameRate),
  });
}
