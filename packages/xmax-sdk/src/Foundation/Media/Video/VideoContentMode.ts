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
 * 视频内容在渲染容器中的显示模式。
 */
export enum VideoContentMode {

  /**
   * 等比完整显示，允许容器留空。
   */
  fit = "fit",

  /**
   * 等比铺满容器，允许裁剪画面。
   */
  fill = "fill",
}
