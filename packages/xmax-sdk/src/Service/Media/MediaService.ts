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
import { alignedVideoSize } from "../../Foundation/Media/Video/VideoSize";

/**
 * Resolves media, generation-canvas, and returned dimensions and queries platform media capabilities.
 */
export class MediaService implements MediaServicing {

  /**
   * The model whose media constraints apply.
   */
  readonly model: RealtimeModelName;

  /**
   * Creates a media service.
   */
  constructor(
    model: RealtimeModelName = RealtimeModel.x2_1
  ) {
    this.model = model;
  }

  /**
   * Resolves a fixed media baseline, preserving content without upscaling and aligning limited
   * dimensions to four pixels. Camera requests must match model resolutions; file and external media may
   * use arbitrary aspect ratios.
   *
   * @param sourceMediaSize - The original media dimensions.
   * @param source - The media source; only camera input validates fixed capture resolutions.
   * @returns The fixed media baseline and initial uplink dimensions.
   */
  resolveMediaSize(
    sourceMediaSize: ModelSize,
    source: "camera" | "image" | "video" | "external"
  ): ModelSize {
    this.validateIntegralSize(sourceMediaSize);
    const buckets = resolutionBuckets(this.model);
    if (source === "camera" && buckets.length > 0) {
      this.resolveModelInputSize(sourceMediaSize);
    }

    const pixels = sourceMediaSize.width * sourceMediaSize.height;
    const scale = Math.min(1, Math.sqrt(maximumInputPixels(this.model) / pixels));
    return alignedVideoSize(
      sourceMediaSize,
      scale,
      4
    );
  }

  /**
   * Selects the closest-aspect generation canvas, or applies model pixel-budget and alignment rules
   * without fixed resolutions.
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
    return {
      width: best.width,
      height: best.height
    };
  }

  /**
   * Resolves bounded returned dimensions without upscaling, preferring the source aspect ratio and
   * four-pixel alignment.
   */
  resolveTargetSize(
    resolvedMediaSize: ModelSize,
    maximumSize: ModelSize
  ): ModelSize {
    this.validateIntegralSize(resolvedMediaSize);
    if (![maximumSize.width, maximumSize.height].every(value => Number.isFinite(value) && value > 0)) {
      throw new XmaxError(
        XmaxErrorCode.invalidConfiguration,
        "Target bounds must be positive and finite"
      );
    }
    const scale = Math.min(1, maximumSize.width / resolvedMediaSize.width, maximumSize.height / resolvedMediaSize.height);
    return alignedVideoSize(
      resolvedMediaSize,
      scale,
      4
    );
  }

  /**
   * Rejects invalid dimensions or pixel areas that cannot be calculated safely.
   */
  private validateIntegralSize(
    size: ModelSize
  ): void {
    if (![size.width, size.height].every(value => Number.isSafeInteger(value) && value > 0) ||
      !Number.isSafeInteger(size.width * size.height)) {
      throw new XmaxError(
        XmaxErrorCode.invalidConfiguration,
        "Media dimensions must be positive safe integers"
      );
    }
  }

  /**
   * Resolves model input dimensions using fixed resolutions or an aligned pixel budget, rejecting
   * unsupported formats.
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
      return {
        width: size.width,
        height: size.height
      };
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
      return {
        width,
        height
      };
    }

    // Alignment can exceed area bounds; select the closest aligned dimensions that remain within the budget.
    return this.boundedAlignedSize(
      validated.width * scale,
      validated.height * scale,
    );
  }

  /**
   * Selects the closest aligned dimensions within the pixel-area limits.
   */
  private boundedAlignedSize(
    width: number,
    height: number
  ): ModelSize {
    const alignment = inputSizeAlignment(this.model);
    const unitPixels = alignment * alignment;
    const minimumUnits = Math.ceil(minimumInputPixels(this.model) / unitPixels);
    const maximumUnits = Math.floor(maximumInputPixels(this.model) / unitPixels);

    let bestSize: ModelSize = {
      width: 0,
      height: 0
    };
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
        bestSize = {
          width: candidateWidth,
          height: candidateHeight
        };
      }
    }

    return bestSize;
  }

  /**
   * Validates finite positive dimensions and normalizes them to integers of at least one pixel.
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
