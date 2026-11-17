//
//  CameraWarmup.ts
//  XmaxSDK
//
//  Author: 翁跃庭 (Yueting Weng)
//  GitHub: https://github.com/Xmax-AI/XmaxSDK-Web
//
//  Copyright (c) 2026 XMAX.AI PTE. LTD.
//

import { XmaxError, XmaxErrorCode } from "../../Errors/XmaxError";

/**
 * The longest delay supported by browser timers.
 */
const MAX_TIMER_DELAY_MS = 2_147_483_647;

/**
 * Waits for camera startup and exposure adjustment. Cancellation and track termination reject
 * immediately and release listeners and timers.
 */
export function waitForCameraWarmup(
  track: MediaStreamTrack,
  warmupMs: number,
  signal: AbortSignal
): Promise<void> {
  return new Promise<void>((
    resolve,
    reject
  ) => {
    let timer: ReturnType<typeof setTimeout> | undefined;
    let settled = false;

    const finish = (error?: XmaxError) => {
      if (settled) {
        return;
      }
      settled = true;
      clearTimeout(timer);
      signal.removeEventListener(
        "abort",
        abort
      );
      track.removeEventListener(
        "ended",
        ended
      );
      if (error) {
        reject(error);
      } else {
        resolve();
      }
    };
    const abort = () => finish(new XmaxError(
      XmaxErrorCode.cancelled,
      "Camera warmup cancelled"
    ));
    const ended = () => finish(new XmaxError(
      XmaxErrorCode.mediaError,
      "Camera track ended before warmup completed"
    ));

    signal.addEventListener(
      "abort",
      abort,
      { once: true }
    );
    track.addEventListener(
      "ended",
      ended,
      { once: true }
    );
    if (signal.aborted) {
      abort();
      return;
    }
    if (track.readyState === "ended") {
      ended();
      return;
    }

    const schedule = (remaining: number) => {
      const delay = Math.min(remaining, MAX_TIMER_DELAY_MS);
      timer = setTimeout(
        () => remaining > delay ? schedule(remaining - delay) : finish(),
        delay
      );
    };
    schedule(warmupMs);
  });
}
