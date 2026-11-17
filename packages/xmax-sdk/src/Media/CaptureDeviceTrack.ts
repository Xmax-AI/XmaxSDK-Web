//
//  CaptureDeviceTrack.ts
//  XmaxSDK
//
//  Author: 翁跃庭 (Yueting Weng)
//  GitHub: https://github.com/Xmax-AI/XmaxSDK-Web
//
//  Copyright (c) 2026 XMAX.AI PTE. LTD.
//

import { XmaxError, XmaxErrorCode } from "../Foundation/Errors/XmaxError";

/** Opens one browser input and releases tracks returned after the operation was cancelled. */
export async function captureDeviceTrack(
  kind: "video" | "audio",
  constraints: MediaTrackConstraints | true,
  signal: AbortSignal,
): Promise<MediaStreamTrack> {
  const label = kind === "video" ? "Camera" : "Microphone";
  const permissionCode = kind === "video" ? XmaxErrorCode.cameraPermissionDenied : XmaxErrorCode.microphonePermissionDenied;
  const cancelled = () => new XmaxError(XmaxErrorCode.cancelled, `${label} capture cancelled`);
  if (signal.aborted) {
    throw cancelled();
  }

  const devices = globalThis.navigator?.mediaDevices;
  if (!devices?.getUserMedia) {
    throw new XmaxError(permissionCode, `${label} capture is unavailable in this browser`);
  }

  let abort: () => void = () => { };
  try {
    const capture = devices.getUserMedia(kind === "video" ? { video: constraints } : { audio: constraints });
    const cancelledCapture = new Promise<never>((_, reject) => {
      abort = () => reject(cancelled());
      signal.addEventListener("abort", abort, { once: true });
      if (signal.aborted) abort();
    });
    const stream = await Promise.race([
      capture.then(stream => {
        if (signal.aborted) {
          stream.getTracks().forEach(track => track.stop());
          throw cancelled();
        }
        return stream;
      }),
      cancelledCapture,
    ]);
    const tracks = stream.getTracks();
    const track = tracks.find(track => track.kind === kind && track.readyState === "live");
    tracks.filter(other => other !== track).forEach(other => other.stop());
    if (!track) {
      throw new XmaxError(XmaxErrorCode.mediaError, `${label} capture produced no live track`);
    }
    return track;
  } catch (error) {
    if (error instanceof XmaxError) {
      throw error;
    }
    const name = error instanceof Error ? error.name : undefined;
    const code = name === "NotAllowedError" || name === "SecurityError" ? permissionCode : XmaxErrorCode.mediaError;
    throw new XmaxError(code, error instanceof Error ? error.message : `${label} capture failed`);
  } finally {
    signal.removeEventListener("abort", abort);
  }
}
