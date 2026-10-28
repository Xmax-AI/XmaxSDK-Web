//
//  NonRealtimeTaskError.ts
//  XmaxSDK
//
//  Author: 翁跃庭 (Yueting Weng)
//  GitHub: https://github.com/Xmax-AI/XmaxSDK-Web
//
//  Copyright (c) 2026 XMAX.AI PTE. LTD.
//

import { XmaxError, XmaxErrorCode } from "../../Foundation/Errors/XmaxError";
import type { NonRealtimeTask } from "./NonRealtimeTask";

/**
 * A failed server task or unavailable terminal result, retaining the last snapshot for display and query
 * recovery.
 */
export class NonRealtimeTaskError extends XmaxError {

  /**
   * The last task snapshot associated with the failure.
   */
  readonly task: NonRealtimeTask;

  /**
   * Creates an API-category error without inventing a server business code.
   */
  constructor(
    task: NonRealtimeTask,
    message: string
  ) {
    super(
      XmaxErrorCode.apiError,
      message
    );
    this.name = "NonRealtimeTaskError";
    this.task = task;
  }
}
