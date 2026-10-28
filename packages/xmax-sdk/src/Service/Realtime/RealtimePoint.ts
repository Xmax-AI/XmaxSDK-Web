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
 * Coordinates in media space.
 */
export interface RealtimePointInit {

  /**
   * The horizontal coordinate; interaction trajectories use normalized values in [0, 1].
   */
  x: number;

  /**
   * The vertical coordinate; interaction trajectories use normalized values in [0, 1].
   */
  y: number;
}

/**
 * A point in media space, using normalized coordinates for interaction trajectories.
 */
export class RealtimePoint {

  /**
   * The horizontal media coordinate.
   */
  readonly x: number;

  /**
   * The vertical media coordinate.
   */
  readonly y: number;

  /**
   * Creates a media-space point.
   */
  constructor(
    init: RealtimePointInit
  ) {
    this.x = init.x;
    this.y = init.y;
  }
}
