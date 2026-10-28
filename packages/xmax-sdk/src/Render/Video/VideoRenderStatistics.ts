//
//  VideoRenderStatistics.ts
//  XmaxSDK
//
//  Author: 翁跃庭 (Yueting Weng)
//  GitHub: https://github.com/Xmax-AI/XmaxSDK-Web
//
//  Copyright (c) 2026 XMAX.AI PTE. LTD.
//

/**
 * A view's recent presentation rate, not the display panel's physical refresh rate.
 */
export interface VideoRenderStatistics {

  /**
   * The video presentation source, measured by presentedFrames increments.
   */
  readonly source: "video";

  /**
   * The video presentation rate, in fps.
   */
  readonly frameRate: number;

  /**
   * The original-video presentation rate, in fps.
   */
  readonly originalFrameRate: number;
}
