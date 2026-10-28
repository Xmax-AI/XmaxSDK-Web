//
//  VideoContentMode.ts
//  XmaxSDK
//
//  Author: 翁跃庭 (Yueting Weng)
//  GitHub: https://github.com/Xmax-AI/XmaxSDK-Web
//
//  Copyright (c) 2026 XMAX.AI PTE. LTD.
//

/**
 * Video layout within a rendering container.
 */
export enum VideoContentMode {

  /**
   * Shows the entire image proportionally, allowing empty container space.
   */
  fit = "fit",

  /**
   * Fills the container proportionally, allowing image cropping.
   */
  fill = "fill",
}
