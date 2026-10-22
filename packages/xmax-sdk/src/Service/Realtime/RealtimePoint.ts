//
//  RealtimePoint.ts
//  XmaxSDK
//
//  Author: 翁跃庭 (Yueting Weng)
//  GitHub: https://github.com/Xmax-AI/XmaxSDK-Web
//
//  Copyright (c) 2026 XMAX.AI PTE. LTD.
//

/**
 * 媒体坐标系中的横纵坐标。
 */
export interface RealtimePointInit {

  /**
   * 媒体横坐标；交互轨迹使用 [0, 1] 归一化值。
   */
  x: number;

  /**
   * 媒体纵坐标；交互轨迹使用 [0, 1] 归一化值。
   */
  y: number;
}

/**
 * 媒体坐标系中的二维点；交互轨迹使用归一化坐标。
 */
export class RealtimePoint {

  /**
   * 媒体横坐标。
   */
  readonly x: number;

  /**
   * 媒体纵坐标。
   */
  readonly y: number;

  /**
   * 创建媒体坐标点。
   */
  constructor(
    init: RealtimePointInit
  ) {
    this.x = init.x;
    this.y = init.y;
  }
}
