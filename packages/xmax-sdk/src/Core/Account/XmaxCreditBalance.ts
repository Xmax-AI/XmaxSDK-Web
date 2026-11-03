//
//  XmaxCreditBalance.ts
//  XmaxSDK
//
//  Author: 翁跃庭 (Yueting Weng)
//  GitHub: https://github.com/Xmax-AI/XmaxSDK-Web
//
//  Copyright (c) 2026 XMAX.AI PTE. LTD.
//

/**
 * The server-reported credit balance for the account owning the client's API key.
 */
export interface XmaxCreditBalance {

  /**
   * The remaining credits as a finite, nonnegative number, including fractional credits.
   */
  readonly currentBalance: number;
}
