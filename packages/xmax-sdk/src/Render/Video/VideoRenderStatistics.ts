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
 * 单个视频视图最近采样窗口的呈现帧率，不代表屏幕实际刷新帧率。
 */
export interface VideoRenderStatistics {

  /**
   * 按浏览器 presentedFrames 增量计数的视频呈现来源。
   */
  readonly source: "video";

  /**
   * 视频呈现帧率，单位 fps。
   */
  readonly frameRate: number;

  /**
   * 原帧呈现帧率，单位 fps。
   */
  readonly originalFrameRate: number;
}
