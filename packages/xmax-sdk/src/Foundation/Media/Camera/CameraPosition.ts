//
//  CameraPosition.ts
//  XmaxSDK
//
//  Author: 翁跃庭 (Yueting Weng)
//  GitHub: https://github.com/Xmax-AI/XmaxSDK-Web
//
//  Copyright (c) 2026 XMAX.AI PTE. LTD.
//

/**
 * The requested capture-camera direction. Desktop rear-camera requests fall back to an available
 * equivalent device.
 */
export enum CameraPosition {

  /**
   * The user-facing camera.
   */
  front = "front",

  /**
   * The environment-facing camera.
   */
  back = "back",
}
