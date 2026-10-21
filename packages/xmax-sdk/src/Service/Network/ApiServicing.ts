//
//  ApiServicing.ts
//  XmaxSDK
//
//  Author: 翁跃庭 (Yueting Weng)
//  GitHub: https://github.com/Xmax-AI/XmaxSDK-Web
//
//  Copyright (c) 2026 XMAX.AI PTE. LTD.
//

/**
 * Xmax API 支持的 HTTP 请求方法。
 */
export enum ApiMethod {

  /**
   * 读取服务端资源。
   */
  get = "GET",

  /**
   * 提交数据或创建资源。
   */
  post = "POST",

  /**
   * 更新服务端资源。
   */
  put = "PUT",

  /**
   * 删除服务端资源。
   */
  delete = "DELETE",
}

/**
 * 请求控制选项；signal 仅取消本地 HTTP 请求，不撤销服务端已执行的操作。
 */
export interface ApiRequestOptions {

  /**
   * 取消请求及后续等待的信号。
   */
  signal?: AbortSignal;

  /**
   * 允许页面退出后继续完成符合浏览器限制的请求。
   */
  keepalive?: boolean;
}

/**
 * 定义 Xmax API 的基础请求能力。
 *
 * 响应统一按 `{ success, code, message, data }` 信封解析，
 * 各方法返回信封中的 `data` 字段。
 */
export interface ApiServicing {

  /**
   * 发送请求并返回统一响应中的数据。
   *
   * @param method HTTP 请求方法。
   * @param path 相对 Base URL 的请求路径。
   * @param body JSON 请求体；无请求体时省略。
   * @returns 统一响应中的 `data` 字段。
   * @throws 配置无效、网络失败、业务失败或响应无法解析时抛出错误。
   */
  request<T>(
    method: ApiMethod,
    path: string,
    body?: unknown,
    options?: ApiRequestOptions
  ): Promise<T>;

  /**
   * 发送 GET 请求。
   */
  get<T>(
    path: string,
    options?: ApiRequestOptions
  ): Promise<T>;

  /**
   * 发送 POST 请求。
   */
  post<T>(
    path: string,
    body?: unknown
  ): Promise<T>;

  /**
   * 发送 PUT 请求。
   */
  put<T>(
    path: string,
    body?: unknown
  ): Promise<T>;

  /**
   * 发送 DELETE 请求。
   *
   * @param options.keepalive 为 true 时请求可存活于页面卸载之后，
   * 用于刷新或关闭页签时的清理请求。
   */
  delete<T>(
    path: string,
    options?: {
      keepalive?: boolean
    }
  ): Promise<T>;
}
