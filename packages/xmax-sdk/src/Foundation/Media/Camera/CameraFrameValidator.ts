//
//  CameraFrameValidator.ts
//  XmaxSDK
//
//  Author: 翁跃庭 (Yueting Weng)
//  GitHub: https://github.com/Xmax-AI/XmaxSDK-Web
//
//  Copyright (c) 2026 XMAX.AI PTE. LTD.
//

import { XmaxError, XmaxErrorCode } from "../../Errors/XmaxError";

/**
 * The fixed camera startup wait covering initial capture and exposure adjustment before RTC publication.
 */
const CAMERA_WARMUP_MS = 200;

/**
 * Waits a fixed interval for camera startup without brightness analysis, image storage, or stopping the
 * source track. Cancellation or track termination rejects immediately and releases listeners and timers.
 */
export function waitForValidCameraFrame(
  track: MediaStreamTrack,
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

    timer = setTimeout(
      () => finish(),
      CAMERA_WARMUP_MS
    );
  });
}
