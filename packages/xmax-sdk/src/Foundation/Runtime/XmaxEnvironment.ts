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
 * Xmax 服务环境。
 */
export enum XmaxEnvironment {

  /**
   * 国内环境。
   */
  china = "china",

  /**
   * 海外环境。
   */
  global = "global",
}

/**
 * 通用 API 与存储服务使用的环境地址。
 */
const API_BASE_URLS: Record<XmaxEnvironment, string> = {
  [XmaxEnvironment.china]: "https://cloud.xmax.22duck.cn/open/api/v1",
  [XmaxEnvironment.global]: "https://api.xmax.cloud/open/api/v1",
};

/**
 * 实时会话服务的环境地址。
 */
const REALTIME_API_BASE_URLS: Record<XmaxEnvironment, string> = {
  [XmaxEnvironment.china]: "https://cloud.xmax.22duck.cn/open/api/v1",
  [XmaxEnvironment.global]: "https://api.xmax.ai/open/api/v1",
};

/**
 * 非实时任务服务的环境地址。
 */
const NON_REALTIME_API_BASE_URLS: Record<XmaxEnvironment, string> = {
  [XmaxEnvironment.china]: "https://api.xmaxai.com/open/api/v1",
  [XmaxEnvironment.global]: "https://api.xmax.ai/open/api/v1",
};

/**
 * 环境对应的 Xmax API Base URL。
 */
export function apiBaseURL(
  environment: XmaxEnvironment
): string {
  return API_BASE_URLS[environment];
}

/**
 * 环境对应的实时会话 API 地址。
 */
export function realtimeApiBaseURL(
  environment: XmaxEnvironment
): string {
  return REALTIME_API_BASE_URLS[environment];
}

/**
 * 环境对应的非实时任务 API Base URL。
 */
export function nonRealtimeApiBaseURL(
  environment: XmaxEnvironment
): string {
  return NON_REALTIME_API_BASE_URLS[environment];
}
