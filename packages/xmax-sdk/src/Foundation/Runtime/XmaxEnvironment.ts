//
//  XmaxEnvironment.ts
//  XmaxSDK
//
//  Author: 翁跃庭 (Yueting Weng)
//  GitHub: https://github.com/Xmax-AI/XmaxSDK-Web
//
//  Copyright (c) 2026 XMAX.AI PTE. LTD.
//

/**
 * Xmax service environments.
 */
export enum XmaxEnvironment {

  /**
   * The China environment.
   */
  china = "china",

  /**
   * The global environment.
   */
  global = "global",
}

/**
 * Environment endpoints for general API and storage services.
 */
const API_BASE_URLS: Record<XmaxEnvironment, string> = {
  [XmaxEnvironment.china]: "https://cloud.xmax.22duck.cn/open/api/v1",
  [XmaxEnvironment.global]: "https://api.xmax.cloud/open/api/v1",
};

/**
 * Environment endpoints for realtime session services.
 */
const REALTIME_API_BASE_URLS: Record<XmaxEnvironment, string> = {
  [XmaxEnvironment.china]: "https://cloud.xmax.22duck.cn/open/api/v1",
  [XmaxEnvironment.global]: "https://api.xmax.ai/open/api/v1",
};

/**
 * Environment endpoints for non-realtime tasks.
 */
const NON_REALTIME_API_BASE_URLS: Record<XmaxEnvironment, string> = {
  [XmaxEnvironment.china]: "https://api.xmaxai.com/open/api/v1",
  [XmaxEnvironment.global]: "https://api.xmax.ai/open/api/v1",
};

/**
 * Returns the general API base URL for an environment.
 */
export function apiBaseURL(
  environment: XmaxEnvironment
): string {
  return API_BASE_URLS[environment];
}

/**
 * Returns the realtime session endpoint for an environment.
 */
export function realtimeApiBaseURL(
  environment: XmaxEnvironment
): string {
  return REALTIME_API_BASE_URLS[environment];
}

/**
 * Returns the non-realtime task endpoint for an environment.
 */
export function nonRealtimeApiBaseURL(
  environment: XmaxEnvironment
): string {
  return NON_REALTIME_API_BASE_URLS[environment];
}
