//
//  MicrophoneCapture.ts
//  XmaxSDK
//
//  Author: 翁跃庭 (Yueting Weng)
//  GitHub: https://github.com/Xmax-AI/XmaxSDK-Web
//
//  Copyright (c) 2026 XMAX.AI PTE. LTD.
//

import { captureDeviceTrack } from "../CaptureDeviceTrack";

/** Opens the selected or default microphone with browser audio processing enabled. */
export function captureMicrophone(signal: AbortSignal, deviceId?: string): Promise<MediaStreamTrack> {
  return captureDeviceTrack("audio", {
    echoCancellation: true,
    autoGainControl: true,
    noiseSuppression: true,
    ...(deviceId === undefined ? {} : { deviceId: { exact: deviceId } }),
  }, signal);
}
