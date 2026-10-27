//
//  MediaOperation.ts
//  XmaxSDK
//
//  Author: 翁跃庭 (Yueting Weng)
//  GitHub: https://github.com/Xmax-AI/XmaxSDK-Web
//
//  Copyright (c) 2026 XMAX.AI PTE. LTD.
//

import { XmaxError, XmaxErrorCode } from "../Errors/XmaxError";

/**
 * 有界等待媒体准备或接入方回调；取消后仍接住迟到的拒绝，清理所有监听和计时器。
 */
export async function waitForMediaOperation<T>(
  operation: Promise<T>, signal: AbortSignal, timeoutMs: number, description: string,
): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  let abort: (() => void) | undefined;
  try {
    const interrupted = new Promise<never>((_, reject) => {
      abort = () => reject(new XmaxError(XmaxErrorCode.cancelled, `${description} cancelled`));
      timer = setTimeout(() => reject(new XmaxError(XmaxErrorCode.timeout, `${description} timed out`)), timeoutMs);
      signal.addEventListener("abort", abort, { once: true });
      if (signal.aborted) {
        abort();
      }
    });
    return await Promise.race([operation, interrupted]);
  } finally {
    clearTimeout(timer);
    if (abort) {
      signal.removeEventListener("abort", abort);
    }
  }
}
