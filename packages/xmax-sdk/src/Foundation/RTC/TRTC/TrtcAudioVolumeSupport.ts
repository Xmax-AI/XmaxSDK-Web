//
//  TrtcAudioVolumeSupport.ts
//  XmaxSDK
//
//  Author: 翁跃庭 (Yueting Weng)
//  GitHub: https://github.com/Xmax-AI/XmaxSDK-Web
//
//  Copyright (c) 2026 XMAX.AI PTE. LTD.
//

/**
 * Replaceable browser capabilities used to detect TRTC volume support.
 */
export interface TrtcAudioVolumeEnvironment {

  /**
   * The browser's User-Agent string.
   */
  userAgent?: string;

  /**
   * The maximum simultaneous touch count.
   */
  maxTouchPoints?: number;
}

/**
 * Checks TRTC remote-volume support. JavaScript media-element volume control is unavailable on iOS
 * Safari and WKWebView. Desktop-User-Agent iPads are identified through touch capability.
 */
export function canControlTrtcRemoteAudioVolume(
  environment?: TrtcAudioVolumeEnvironment,
): boolean {
  const userAgent =
    environment?.userAgent ??
    (typeof navigator === "undefined" ? "" : navigator.userAgent);
  const maxTouchPoints =
    environment?.maxTouchPoints ??
    (typeof navigator === "undefined" ? 0 : navigator.maxTouchPoints ?? 0);

  const ios =
    /iPhone|iPad|iPod/i.test(userAgent) ||
    (/Macintosh/i.test(userAgent) && maxTouchPoints > 1);
  return !ios;
}
