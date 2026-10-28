//
//  MediaServicing.ts
//  XmaxSDK
//
//  Author: 翁跃庭 (Yueting Weng)
//  GitHub: https://github.com/Xmax-AI/XmaxSDK-Web
//
//  Copyright (c) 2026 XMAX.AI PTE. LTD.
//

import type { ModelSize, RealtimeModelName } from "../Realtime/RealtimeModel";

/**
 * Media-input rules and platform media-capability queries.
 */
export interface MediaServicing {

  /**
   * The model whose media rules apply.
   */
  readonly model: RealtimeModelName;

  /**
   * Resolves original media dimensions without upscaling, applying area limits and four-pixel alignment.
   * Only camera sources must match fixed model resolutions.
   *
   * @param sourceMediaSize - The original media dimensions.
   * @param source - The media source; file and external inputs accept arbitrary aspect ratios.
   * @returns The fixed media baseline and initial uplink dimensions.
   */
  resolveMediaSize(
    sourceMediaSize: ModelSize,
    source: "camera" | "image" | "video" | "external"
  ): ModelSize;

  /**
   * Selects a generation canvas for resolved media without changing local media dimensions.
   */
  resolveGenerationSize(
    resolvedMediaSize: ModelSize
  ): ModelSize;

  /**
   * Resolves four-pixel-aligned returned dimensions from the fixed media baseline and downlink bounds.
   */
  resolveTargetSize(
    resolvedMediaSize: ModelSize,
    maximumSize: ModelSize
  ): ModelSize;

  /**
   * Resolves a model-supported capture format or generation canvas without processing pixels. Fixed
   * resolutions require an exact match; otherwise dimensions scale within the pixel budget and align to
   * the model's requirements.
   *
   * @throws An error for invalid or unsupported dimensions.
   */
  resolveModelInputSize(
    size: ModelSize
  ): ModelSize;
}
