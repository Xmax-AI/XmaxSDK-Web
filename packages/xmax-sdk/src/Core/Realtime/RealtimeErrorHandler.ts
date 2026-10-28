//
//  RealtimeErrorHandler.ts
//  XmaxSDK
//
//  Author: 翁跃庭 (Yueting Weng)
//  GitHub: https://github.com/Xmax-AI/XmaxSDK-Web
//
//  Copyright (c) 2026 XMAX.AI PTE. LTD.
//

import { XmaxError, XmaxErrorCode } from "../../Foundation/Errors/XmaxError";
import { XmaxLogger } from "../../Foundation/Logging/XmaxLogger";
import { RealtimeTerminationScope } from "./RealtimeCoordinator";

/**
 * Reports asynchronous realtime failures through logging and retains pending errors.
 */
export class RealtimeErrorHandler {

  /**
   * The pending failures awaiting lifecycle invalidation.
   */
  private pendingFailures: XmaxError[] = [];

  /**
   * Records a realtime failure and outputs its diagnostic log.
   */
  async report(
    error: XmaxError
  ): Promise<void> {
    if (error.code === XmaxErrorCode.cancelled) {
      return;
    }
    this.pendingFailures.push(error);
    XmaxLogger.realtime.error(
      () =>
        `实时业务错误 (Realtime Error)\n└─ ${XmaxLogger.localized("原因：", "Reason: ")}` +
        `${error.code} ${error.message}`,
    );
  }

  /**
   * Clears background failures belonging to a terminated lifecycle.
   */
  invalidatePendingFailures(
    _target: RealtimeTerminationScope
  ): void {
    this.pendingFailures = [];
  }
}
