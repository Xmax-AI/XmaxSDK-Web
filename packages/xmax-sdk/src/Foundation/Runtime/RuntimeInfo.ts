//
//  RuntimeInfo.ts
//  XmaxSDK
//
//  Author: 翁跃庭 (Yueting Weng)
//  GitHub: https://github.com/Xmax-AI/XmaxSDK-Web
//
//  Copyright (c) 2026 XMAX.AI PTE. LTD.
//

/**
 * The current SDK version.
 */
export const XMAX_SDK_VERSION = "1.1.1";

/**
 * SDK and browser metadata included with business requests.
 */
export interface RuntimeInfoSnapshot {

  /**
   * The runtime platform ID.
   */
  platform: string;

  /**
   * The operating-system or browser version description.
   */
  osVersion: string;

  /**
   * The SDK version.
   */
  sdkVersion: string;

  /**
   * The device or browser description.
   */
  deviceModel: string;
}

/**
 * Describes the SDK runtime environment.
 */
export class RuntimeInfo {

  /**
   * The current runtime metadata snapshot.
   */
  static readonly current: RuntimeInfoSnapshot = {
    platform: "web",
    osVersion: RuntimeInfo.currentOSVersion(),
    sdkVersion: XMAX_SDK_VERSION,
    deviceModel: "browser",
  };

  /**
   * Serializes runtime metadata to API snake_case fields.
   */
  static toJSON(
    snapshot: RuntimeInfoSnapshot = RuntimeInfo.current
  ): Record<string, string> {
    return {
      platform: snapshot.platform,
      os_version: snapshot.osVersion,
      sdk_version: snapshot.sdkVersion,
      device_model: snapshot.deviceModel,
    };
  }

  /**
   * Returns the browser User-Agent, or unknown outside a browser.
   */
  private static currentOSVersion(): string {
    if (typeof navigator !== "undefined" && navigator.userAgent) {
      return navigator.userAgent;
    }
    return "unknown";
  }
}
