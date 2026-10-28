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
 * A press-to-release trajectory ID independent of browser pointer-ID reuse.
 */
export type TrajectoryID = number;

/**
 * A visual-effect pointer sample, using CSS pixels for location and milliseconds for time.
 */
export interface TrajectoryPoint {

  /**
   * The ID retained across samples of the same trajectory.
   */
  readonly id: TrajectoryID;

  /**
   * The pointer's viewport position, in CSS pixels.
   */
  readonly location: Readonly<{
    x: number;
    y: number
  }>;

  /**
   * The normalized viewport position, with each coordinate from 0 to 1.
   */
  readonly normalizedLocation: Readonly<{
    x: number;
    y: number
  }>;

  /**
   * The monotonic sampling time, in milliseconds.
   */
  readonly timestamp: number;
}
