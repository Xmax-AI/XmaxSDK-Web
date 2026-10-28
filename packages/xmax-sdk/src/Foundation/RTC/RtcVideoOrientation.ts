//
//  RtcVideoOrientation.ts
//  XmaxSDK
//
//  Author: 翁跃庭 (Yueting Weng)
//  GitHub: https://github.com/Xmax-AI/XmaxSDK-Web
//
//  Copyright (c) 2026 XMAX.AI PTE. LTD.
//

/**
 * Replaceable browser orientation data, defaulting to the current browser environment.
 */
export interface RtcOrientationEnvironment {

  /**
   * The browser's User-Agent string.
   */
  userAgent?: string;

  /**
   * The device's maximum simultaneous touch count.
   */
  maxTouchPoints?: number;

  /**
   * The screen.orientation.type value, such as portrait-primary.
   */
  orientationType?: string;

  /**
   * The legacy window.orientation angle used when orientationType is unavailable.
   */
  orientationDegrees?: number;
}

/**
 * Determines whether mobile portrait encoding requires transposed dimensions. TRTC, Agora, and VeRTC
 * capture/encoding paths may transpose mobile portrait dimensions. Adapter dimensions compensate while
 * business requests and reported statistics remain unchanged.
 */
export function shouldTransposeRtcVideoSize(
  environment?: RtcOrientationEnvironment,
): boolean {
  const userAgent =
    environment?.userAgent ??
    (typeof navigator === "undefined" ? "" : navigator.userAgent);
  const maxTouchPoints =
    environment?.maxTouchPoints ??
    (typeof navigator === "undefined" ? 0 : navigator.maxTouchPoints ?? 0);

  // Identify desktop-User-Agent iPads by their touch capability.
  const mobile =
    /Android|webOS|iPhone|iPad|iPod|Mobile/i.test(userAgent) ||
    (/Macintosh/i.test(userAgent) && maxTouchPoints > 1);
  if (!mobile) {
    return false;
  }

  const orientationType =
    environment?.orientationType ??
    (typeof window === "undefined" ? undefined : window.screen?.orientation?.type);
  if (orientationType !== undefined) {
    return orientationType.includes("portrait");
  }

  const degrees =
    environment?.orientationDegrees ??
    (typeof window === "undefined"
      ? undefined
      : (window as unknown as {
        orientation?: number
      }).orientation);
  return degrees === 0 || degrees === 180;
}

/**
 * Returns transposed dimensions for mobile portrait input, leaving other orientations unchanged.
 */
export function rtcOrientedVideoSize(
  size: {
    width: number;
    height: number
  },
  environment?: RtcOrientationEnvironment,
): {
  width: number;
  height: number
} {
  return shouldTransposeRtcVideoSize(environment)
    ? {
      width: size.height,
      height: size.width
    }
    : size;
}
