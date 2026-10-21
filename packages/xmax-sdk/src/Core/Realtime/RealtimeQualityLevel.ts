//
//  RealtimeQualityLevel.ts
//  XmaxSDK
//
//  Author: 翁跃庭 (Yueting Weng)
//  GitHub: https://github.com/Xmax-AI/XmaxSDK-Web
//
//  Copyright (c) 2026 XMAX.AI PTE. LTD.
//

/**
 * 实时传输档位；L1 质量最高，L5 最节省带宽，与网络质量评级无关。
 */
export enum RealtimeQualityLevel {

  /**
   * 保留媒体基准尺寸。
   */
  l1 = 1,

  /**
   * 目标宽高为媒体基准的 80%。
   */
  l2 = 2,

  /**
   * 目标宽高为媒体基准的 65%。
   */
  l3 = 3,

  /**
   * 目标宽高为媒体基准的 50%。
   */
  l4 = 4,

  /**
   * 目标宽高为媒体基准的 40%，上行帧率上限为 16 fps。
   */
  l5 = 5,
}
