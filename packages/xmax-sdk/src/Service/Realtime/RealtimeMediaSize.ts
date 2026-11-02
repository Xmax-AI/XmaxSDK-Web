//
//  RealtimeMediaSize.ts
//  XmaxSDK
//
//  Author: 翁跃庭 (Yueting Weng)
//  GitHub: https://github.com/Xmax-AI/XmaxSDK-Web
//
//  Copyright (c) 2026 XMAX.AI PTE. LTD.
//

/**
 * The fixed local media dimensions after model sizing and alignment, independent of quality changes.
 */
export interface RealtimeMediaSize {

  /**
   * The resolved width, in pixels.
   */
  readonly width: number;

  /**
   * The resolved height, in pixels.
   */
  readonly height: number;
}

/**
 * Receives an immutable size snapshot, or undefined before resolution and after local media is released.
 */
export type RealtimeMediaSizeListener = (
  size?: RealtimeMediaSize
) => void;
