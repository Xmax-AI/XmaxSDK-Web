//
//  InteractionFrame.ts
//  XmaxSDK
//
//  Author: 翁跃庭 (Yueting Weng)
//  GitHub: https://github.com/Xmax-AI/XmaxSDK-Web
//
//  Copyright (c) 2026 XMAX.AI PTE. LTD.
//

import type { VideoContentMode } from "../../Foundation/Media/Video/VideoContentMode";

/**
 * A viewport interaction snapshot in CSS pixels, without retaining DOM events.
 */
export interface InteractionFrame {

  /**
   * The touch positions at one sampling instant.
   */
  readonly points: readonly Readonly<{
    x: number;
    y: number
  }>[];

  /**
   * The viewport dimensions, in CSS pixels.
   */
  readonly viewportSize: Readonly<{
    width: number;
    height: number
  }>;

  /**
   * The image scaling and cropping mode within the viewport.
   */
  readonly contentMode: VideoContentMode;

  /**
   * Whether the displayed image is horizontally mirrored.
   */
  readonly mirrored: boolean;
}
