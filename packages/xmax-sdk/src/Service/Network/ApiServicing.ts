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
 * HTTP methods supported by the Xmax API.
 */
export enum ApiMethod {

  /**
   * Reads a server resource.
   */
  get = "GET",

  /**
   * Submits data or creates a resource.
   */
  post = "POST",

  /**
   * Updates a server resource.
   */
  put = "PUT",

  /**
   * Deletes a server resource.
   */
  delete = "DELETE",
}

/**
 * Request controls. Cancellation stops local HTTP work without undoing server-side operations.
 */
export interface ApiRequestOptions {

  /**
   * The signal cancelling a request and subsequent waits.
   */
  signal?: AbortSignal;

  /**
   * Whether a browser-permitted request may finish after page unload.
   */
  keepalive?: boolean;
}

/**
 * The shared Xmax API request capabilities. Responses use the success/code/message/data envelope;
 * methods return its data field.
 */
export interface ApiServicing {

  /**
   * Sends a request and returns response-envelope data.
   *
   * @param method - The HTTP method.
   * @param path - The path relative to the base URL.
   * @param body - The optional JSON request body.
   * @returns The response's data field.
   * @throws Rejects for invalid configuration, network or business failure, or an unparseable response.
   */
  request<T>(
    method: ApiMethod,
    path: string,
    body?: unknown,
    options?: ApiRequestOptions
  ): Promise<T>;

  /**
   * Sends a GET request.
   */
  get<T>(
    path: string,
    options?: ApiRequestOptions
  ): Promise<T>;

  /**
   * Sends a POST request.
   */
  post<T>(
    path: string,
    body?: unknown
  ): Promise<T>;

  /**
   * Sends a PUT request.
   */
  put<T>(
    path: string,
    body?: unknown
  ): Promise<T>;

  /**
   * Sends a DELETE request.
   *
   * @param options.keepalive - Whether a cleanup request may survive page refresh or closure.
   */
  delete<T>(
    path: string,
    options?: {
      keepalive?: boolean
    }
  ): Promise<T>;
}
