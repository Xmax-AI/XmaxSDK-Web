//
//  TrajectoryPoint.ts
//  XmaxSDK
//
//  Author: 翁跃庭 (Yueting Weng)
//  GitHub: https://github.com/Xmax-AI/XmaxSDK-Web
//
//  Copyright (c) 2026 XMAX.AI PTE. LTD.
//

/**
 * 单次按下到释放期间稳定的轨迹标识，不依赖浏览器复用的 pointerId。
 */
export type TrajectoryID = number;

/**
 * 供视觉效果使用的触点；location 为视口 CSS 像素，timestamp 为毫秒。
 */
export interface TrajectoryPoint {

  /**
   * 同一触点在连续采样期间保持不变的轨迹标识。
   */
  readonly id: TrajectoryID;

  /**
   * 触点在视口中的位置，单位为 CSS 像素。
   */
  readonly location: Readonly<{
    x: number;
    y: number
  }>;

  /**
   * 触点在视口中的归一化位置，横纵范围为 0–1。
   */
  readonly normalizedLocation: Readonly<{
    x: number;
    y: number
  }>;

  /**
   * 触点采样时的单调时钟时间，单位为毫秒。
   */
  readonly timestamp: number;
}
