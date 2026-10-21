//
//  RtcProvider.ts
//  XmaxSDK
//
//  Author: 翁跃庭 (Yueting Weng)
//  GitHub: https://github.com/Xmax-AI/XmaxSDK-Web
//
//  Copyright (c) 2026 XMAX.AI PTE. LTD.
//

/**
 * 实时媒体使用的 RTC 提供方；一个 Manager 生命周期内保持不变。
 */
export enum RtcProvider {

  /**
   * 腾讯实时音视频。
   */
  trtc = "trtc",

  /**
   * 声网实时音视频。
   */
  agora = "agora",

  /**
   * 火山引擎实时音视频。
   */
  vertc = "vertc",
}
