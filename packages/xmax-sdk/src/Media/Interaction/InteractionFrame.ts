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
 * 从显示视口采集的交互快照；坐标单位为 CSS 像素，不持有 DOM 事件。
 */
export interface InteractionFrame {

  /**
   * 同一采样时刻的触点位置。
   */
  readonly points: readonly Readonly<{
    x: number;
    y: number
  }>[];

  /**
   * 显示视口的宽高，单位为 CSS 像素。
   */
  readonly viewportSize: Readonly<{
    width: number;
    height: number
  }>;

  /**
   * 画面在视口中的缩放与裁剪方式。
   */
  readonly contentMode: VideoContentMode;

  /**
   * 是否对显示画面应用水平镜像。
   */
  readonly mirrored: boolean;
}
