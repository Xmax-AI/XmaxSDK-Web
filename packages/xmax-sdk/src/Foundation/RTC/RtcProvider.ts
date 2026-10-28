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
 * The RTC provider, fixed for one realtime manager's lifetime.
 */
export enum RtcProvider {

  /**
   * Tencent TRTC.
   */
  trtc = "trtc",

  /**
   * Agora RTC.
   */
  agora = "agora",

  /**
   * Volcengine RTC.
   */
  vertc = "vertc",
}
