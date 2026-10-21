//
//  MediaService.ts
//  XmaxSDK
//
//  Author: 翁跃庭 (Yueting Weng)
//  GitHub: https://github.com/Xmax-AI/XmaxSDK-Web
//
//  Copyright (c) 2026 XMAX.AI PTE. LTD.
//

import {
  inputSizeAlignment,
  maximumInputPixels,
  minimumInputPixels,
  RealtimeModel,
  resolutionBuckets,
  type ModelSize,
  type RealtimeModelName,
} from "../Realtime/RealtimeModel";
import { XmaxError, XmaxErrorCode } from "../../Foundation/Errors/XmaxError";
import type { MediaServicing } from "./MediaServicing";
import { frameInterpolationAdapter } from "../../Foundation/Media/Video/FrameInterpolationSupport";
import { alignedVideoSize } from "../../Foundation/Media/Video/VideoSize";

/**
 * 统一计算本地媒体、生成画布及回传尺寸，并查询平台媒体能力。
 */
export class MediaService implements MediaServicing {

  /**
   * 模型约束
   */
  readonly model: RealtimeModelName;

  /**
   * 创建媒体服务。
   */
  constructor(
    model: RealtimeModelName = RealtimeModel.x2_1_1_preview_cn
  ) {
    this.model = model;
  }

  /**
   * 解析固定媒体基准：保留完整内容、不放大、限制面积并按 4 对齐。
   * 摄像头请求尺寸须先匹配模型桶；文件媒体不受模型桶比例限制。
   */
  resolveMediaSize(
    sourceMediaSize: ModelSize,
    source: "camera" | "image" | "video"
  ): ModelSize {
    this.validateIntegralSize(sourceMediaSize);
    const buckets = resolutionBuckets(this.model);
    if (source === "camera" && buckets.length > 0) {
      this.resolveModelInputSize(sourceMediaSize);
    }

    const pixels = sourceMediaSize.width * sourceMediaSize.height;
    const scale = Math.min(1, Math.sqrt(maximumInputPixels(this.model) / pixels));
    return alignedVideoSize(sourceMediaSize, scale, 4);
  }

  /**
   * 选择比例最接近的模型生成画布；无固定桶时按模型像素预算和对齐规则计算。
   */
  resolveGenerationSize(
    resolvedMediaSize: ModelSize
  ): ModelSize {
    this.validateIntegralSize(resolvedMediaSize);
    const buckets = resolutionBuckets(this.model);
    if (buckets.length === 0) {
      return this.resolveModelInputSize(resolvedMediaSize);
    }

    const aspect = resolvedMediaSize.width / resolvedMediaSize.height;
    let best = buckets[0]!;
    let distance = Math.abs(Math.log(aspect / (best.width / best.height)));
    for (const bucket of buckets.slice(1)) {
      const candidate = Math.abs(Math.log(aspect / (bucket.width / bucket.height)));
      if (candidate < distance) {
        best = bucket;
        distance = candidate;
      }
    }
    return { width: best.width, height: best.height };
  }

  /**
   * 综合下行宽高上限计算回传尺寸，不放大、优先保持比例并按 4 对齐。
   * 插帧在 WebGPU 内部补边，不因开启插帧额外缩小回传画面。
   */
  resolveTargetSize(
    resolvedMediaSize: ModelSize,
    maximumSize: ModelSize
  ): ModelSize {
    this.validateIntegralSize(resolvedMediaSize);
    if (![maximumSize.width, maximumSize.height].every(value => Number.isFinite(value) && value > 0)) {
      throw new XmaxError(XmaxErrorCode.invalidConfiguration, "Target bounds must be positive and finite");
    }
    const scale = Math.min(1, maximumSize.width / resolvedMediaSize.width, maximumSize.height / resolvedMediaSize.height);
    return alignedVideoSize(resolvedMediaSize, scale, 4);
  }

  /**
   * 拒绝无效或不能安全参与面积计算的媒体像素尺寸。
   */
  private validateIntegralSize(
    size: ModelSize
  ): void {
    if (![size.width, size.height].every(value => Number.isSafeInteger(value) && value > 0) ||
      !Number.isSafeInteger(size.width * size.height)) {
      throw new XmaxError(XmaxErrorCode.invalidConfiguration, "Media dimensions must be positive safe integers");
    }
  }

  /**
   * Web 插帧保留原始尺寸；/16 对齐由 GPU 内部补边处理，不缩小回传视频。
   */
  resolveFrameInterpolationSize(
    size: ModelSize
  ): ModelSize {
    const { width, height } = size;
    if (!Number.isSafeInteger(width) || !Number.isSafeInteger(height) || width <= 0 || height <= 0) {
      throw new XmaxError(XmaxErrorCode.invalidConfiguration, "Video dimensions must be positive integers");
    }
    return { width, height };
  }

  /**
   * WebGPU 适配器探测是异步的；实际性能和运行状态由渲染管线判断。
   */
  async supportsFrameInterpolation(
    size: ModelSize
  ): Promise<boolean> {
    return (await frameInterpolationAdapter(size)) !== null;
  }

  /**
   * 按模型分辨率档位或像素预算解析输入尺寸，保持宽高比例并对齐；不支持的规格抛错。
   */
  resolveModelInputSize(
    size: ModelSize
  ): ModelSize {
    const buckets = resolutionBuckets(this.model);
    if (buckets.length > 0) {
      const matched = buckets.some(
        (bucket) => bucket.width === size.width && bucket.height === size.height,
      );
      if (!matched) {
        const supportedSizes = buckets
          .map((bucket) => `${bucket.width}×${bucket.height}`)
          .join(", ");
        throw new XmaxError(
          XmaxErrorCode.invalidConfiguration,
          `Model ${this.model} does not support input resolution ` +
          `${size.width}×${size.height}. Supported resolutions: ${supportedSizes}`,
        );
      }
      return { width: size.width, height: size.height };
    }

    const validated = this.validatedSize(size);
    const pixels = validated.width * validated.height;
    const minimumPixels = minimumInputPixels(this.model);
    const maximumPixels = maximumInputPixels(this.model);

    let scale: number;
    let rounding: (
      value: number
    ) => number;
    if (pixels < minimumPixels) {
      scale = Math.sqrt(minimumPixels / pixels);
      rounding = Math.ceil;
    } else if (pixels > maximumPixels) {
      scale = Math.sqrt(maximumPixels / pixels);
      rounding = Math.floor;
    } else {
      scale = 1;
      rounding = Math.round;
    }

    const alignment = inputSizeAlignment(this.model);
    const width = Math.max(
      rounding((validated.width * scale) / alignment) * alignment,
      alignment,
    );
    const height = Math.max(
      rounding((validated.height * scale) / alignment) * alignment,
      alignment,
    );

    const alignedPixels = width * height;
    if (alignedPixels >= minimumPixels && alignedPixels <= maximumPixels) {
      return { width, height };
    }

    // 对齐可能使边界附近的尺寸越界，选择满足面积限制且最接近目标的尺寸。
    return this.boundedAlignedSize(
      validated.width * scale,
      validated.height * scale,
    );
  }

  /**
   * 在对齐网格上选择满足面积限制且最接近目标的尺寸。
   */
  private boundedAlignedSize(
    width: number,
    height: number
  ): ModelSize {
    const alignment = inputSizeAlignment(this.model);
    const unitPixels = alignment * alignment;
    const minimumUnits = Math.ceil(minimumInputPixels(this.model) / unitPixels);
    const maximumUnits = Math.floor(maximumInputPixels(this.model) / unitPixels);

    let bestSize: ModelSize = { width: 0, height: 0 };
    let bestDistance = Number.POSITIVE_INFINITY;

    for (let widthUnits = 1; widthUnits <= maximumUnits; widthUnits += 1) {
      const minimumHeight = Math.ceil(minimumUnits / widthUnits);
      const maximumHeight = Math.floor(maximumUnits / widthUnits);
      if (minimumHeight > maximumHeight) {
        continue;
      }
      const heightUnits = Math.min(
        Math.max(Math.round(height / alignment), minimumHeight),
        maximumHeight,
      );
      const candidateWidth = widthUnits * alignment;
      const candidateHeight = heightUnits * alignment;
      const distance =
        ((candidateWidth - width) / width) ** 2 +
        ((candidateHeight - height) / height) ** 2;
      if (distance < bestDistance) {
        bestDistance = distance;
        bestSize = { width: candidateWidth, height: candidateHeight };
      }
    }

    return bestSize;
  }

  /**
   * 校验尺寸为有限正数，并归一化为不小于 1 的整数。
   */
  private validatedSize(
    size: ModelSize
  ): ModelSize {
    if (
      !Number.isFinite(size.width) ||
      !Number.isFinite(size.height) ||
      size.width <= 0 ||
      size.height <= 0
    ) {
      throw new XmaxError(
        XmaxErrorCode.invalidConfiguration,
        "Image width and height must be finite numbers greater than zero",
      );
    }
    return {
      width: Math.max(Math.round(size.width), 1),
      height: Math.max(Math.round(size.height), 1),
    };
  }
}
