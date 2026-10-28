//
//  ApiService.ts
//  XmaxSDK
//
//  Author: 翁跃庭 (Yueting Weng)
//  GitHub: https://github.com/Xmax-AI/XmaxSDK-Web
//
//  Copyright (c) 2026 XMAX.AI PTE. LTD.
//

import { XmaxError, XmaxErrorCode } from "../../Foundation/Errors/XmaxError";
import { XmaxLogger } from "../../Foundation/Logging/XmaxLogger";
import { XMAX_SDK_VERSION } from "../../Foundation/Runtime/RuntimeInfo";
import { ApiMethod, type ApiServicing, type ApiRequestOptions } from "./ApiServicing";

/**
 * Shared metadata in the Xmax API response envelope.
 */
interface EnvelopeMetadata {

  /**
   * The server's business-success indicator.
   */
  success?: boolean;

  /**
   * The server's business status code.
   */
  code?: number;

  /**
   * The server's status message.
   */
  message?: string;
}

/**
 * The replaceable fetch contract used by API requests.
 */
export type ApiFetch = (
  url: string,
  init: {
    method: string;
    headers: Record<string, string>;
    body?: string;
    signal?: AbortSignal;
    keepalive?: boolean;
  },
) => Promise<{
  status: number;

  /**
   * Reads response text for envelope parsing.
   */
  text(): Promise<string>;
}>;

/**
 * API authentication, endpoint, and transport configuration.
 */
export interface ApiServiceOptions {

  /**
   * The API key used to access Xmax services.
   */
  apiKey: string;

  /**
   * Xmax API Base URL。
   */
  baseURL: string;

  /**
   * The request timeout, in milliseconds; defaults to 15000.
   */
  timeoutMs?: number;

  /**
   * The replaceable fetch implementation.
   */
  fetchImpl?: ApiFetch;
}

/**
 * Sends Xmax API requests and normalizes responses, logs, and errors.
 */
export class ApiService implements ApiServicing {

  /**
   * The default request timeout, in milliseconds.
   */
  static readonly defaultTimeoutMs = 15_000;

  /**
   * The key authenticating API requests.
   */
  private readonly apiKey: string;

  /**
   * The base URL for API requests.
   */
  private readonly baseURL: string;

  /**
   * The timeout for each request, in milliseconds.
   */
  private readonly timeoutMs: number;

  /**
   * The HTTP transport implementation.
   */
  private readonly fetchImpl: ApiFetch;

  /**
   * Creates an API service.
   */
  constructor(
    options: ApiServiceOptions
  ) {
    this.apiKey = options.apiKey.trim();
    this.baseURL = options.baseURL;
    this.timeoutMs = options.timeoutMs ?? ApiService.defaultTimeoutMs;

    this.fetchImpl = options.fetchImpl ?? ((
      url,
      init
    ) => fetch(
      url,
      init
    ));
  }

  /**
   * Sends a request and returns the envelope's data.
   *
   * @param options.keepalive - Whether the browser may complete this request after page unload.
   */
  async request<T>(
    method: ApiMethod,
    path: string,
    body?: unknown,
    options?: ApiRequestOptions
  ): Promise<T> {
    this.validateConfiguration();
    if (options?.signal?.aborted) {
      throw new XmaxError(
        XmaxErrorCode.cancelled,
        "API request was cancelled"
      );
    }

    const request = this.makeRequest(
      method,
      path,
      body,
      options
    );
    const startedAt = Date.now();

    // Combine request timeout and caller cancellation without requiring AbortSignal.any.
    const timeoutSignal = request.init.signal!;
    const controller = new AbortController();
    const abortTimeout = () => controller.abort(timeoutSignal.reason);
    const abortCaller = () => controller.abort(new DOMException(
      "Cancelled",
      "AbortError"
    ));
    timeoutSignal.addEventListener(
      "abort",
      abortTimeout,
      { once: true }
    );
    options?.signal?.addEventListener(
      "abort",
      abortCaller,
      { once: true }
    );
    request.init.signal = controller.signal;
    if (timeoutSignal.aborted) {
      abortTimeout();
    }
    if (options?.signal?.aborted) {
      abortCaller();
    }

    let status: number;
    let text: string;
    try {
      const response = await this.fetchImpl(
        request.url,
        request.init
      );
      status = response.status;
      text = await response.text();
    } catch (error) {
      const mapped = ApiService.transportError(error);
      this.logFailure(
        method,
        path,
        mapped,
        startedAt
      );
      throw mapped;
    } finally {
      timeoutSignal.removeEventListener(
        "abort",
        abortTimeout
      );
      options?.signal?.removeEventListener(
        "abort",
        abortCaller
      );
    }

    try {
      const value = ApiService.parseResponse<T>(
        text,
        status
      );
      XmaxLogger.api.debug(
        () =>
          `API 请求成功 (API Request Succeeded)\n` +
          `└─ ${method} ${path} · ${status} · ${Date.now() - startedAt}ms`,
      );
      return value;
    } catch (error) {
      const mapped = XmaxError.from(error);
      this.logFailure(
        method,
        path,
        mapped,
        startedAt
      );
      throw mapped;
    }
  }

  /**
   * Sends a GET request.
   */
  get<T>(
    path: string,
    options?: ApiRequestOptions
  ): Promise<T> {
    return this.request<T>(
      ApiMethod.get,
      path,
      undefined,
      options
    );
  }

  /**
   * Sends a POST request.
   */
  post<T>(
    path: string,
    body?: unknown
  ): Promise<T> {
    return this.request<T>(
      ApiMethod.post,
      path,
      body
    );
  }

  /**
   * Sends a PUT request.
   */
  put<T>(
    path: string,
    body?: unknown
  ): Promise<T> {
    return this.request<T>(
      ApiMethod.put,
      path,
      body
    );
  }

  /**
   * Sends a DELETE request.
   */
  delete<T>(
    path: string,
    options?: {
      keepalive?: boolean
    }
  ): Promise<T> {
    return this.request<T>(
      ApiMethod.delete,
      path,
      undefined,
      options
    );
  }

  /**
   * Validates API key and base URL configuration.
   */
  private validateConfiguration(): void {
    if (this.apiKey.length === 0) {
      throw new XmaxError(
        XmaxErrorCode.invalidAPIKey,
        "API key cannot be empty"
      );
    }

    let url: URL;
    try {
      url = new URL(this.baseURL);
    } catch {
      throw new XmaxError(
        XmaxErrorCode.invalidConfiguration,
        "API service configuration is invalid",
      );
    }

    const isSecure = url.protocol === "https:";
    const isLocalhost =
      url.protocol === "http:" &&
      (url.hostname === "localhost" || url.hostname === "127.0.0.1");
    if ((!isSecure && !isLocalhost) || this.timeoutMs <= 0) {
      throw new XmaxError(
        XmaxErrorCode.invalidConfiguration,
        "API service configuration is invalid",
      );
    }
  }

  /**
   * Builds the URL, headers, and body, accepting only relative paths on the base URL's origin.
   */
  private makeRequest(
    method: ApiMethod,
    path: string,
    body?: unknown,
    options?: {
      keepalive?: boolean
    },
  ): {
    url: string;
    init: {
      method: string;
      headers: Record<string, string>;
      body?: string;
      signal?: AbortSignal;
      keepalive?: boolean;
    };
  } {
    const normalizedPath = path.trim();
    if (
      normalizedPath.length === 0 ||
      normalizedPath.includes("://") ||
      normalizedPath.startsWith("//")
    ) {
      throw new XmaxError(
        XmaxErrorCode.invalidConfiguration,
        "API request path is invalid",
      );
    }

    const base = this.baseURL.endsWith("/") ? this.baseURL.slice(
      0,
      -1
    ) : this.baseURL;
    const relativePath = normalizedPath.startsWith("/")
      ? normalizedPath
      : `/${normalizedPath}`;
    const url = new URL(base + relativePath);
    const baseURLObj = new URL(base);
    if (
      url.protocol.toLowerCase() !== baseURLObj.protocol.toLowerCase() ||
      url.host.toLowerCase() !== baseURLObj.host.toLowerCase()
    ) {
      throw new XmaxError(
        XmaxErrorCode.invalidConfiguration,
        "API request path is invalid",
      );
    }

    let encodedBody: string | undefined;
    if (body !== undefined) {
      try {
        encodedBody = JSON.stringify(body);
      } catch {
        throw new XmaxError(
          XmaxErrorCode.apiError,
          "Failed to encode API request body",
        );
      }
    }

    return {
      url: url.toString(),
      init: {
        method,
        headers: {
          Accept: "application/json",
          "Content-Type": "application/json",
          "X-Api-Key": this.apiKey,
          "X-Platform": "web",
          "X-SDK-Version": XMAX_SDK_VERSION,
        },
        body: encodedBody,
        signal: AbortSignal.timeout(this.timeoutMs),
        ...(options?.keepalive ? { keepalive: true } : {}),
      },
    };
  }

  /**
   * Parses envelope data, rejecting business failures and missing payloads.
   */
  private static parseResponse<T>(
    text: string,
    status: number
  ): T {
    let envelope: EnvelopeMetadata & {
      data?: T
    };
    try {
      envelope = JSON.parse(text);
    } catch {
      throw new XmaxError(
        XmaxErrorCode.apiError,
        "Server returned invalid JSON",
        {
          httpStatus: status,
        }
      );
    }

    const ok = status >= 200 && status < 300;
    const succeeded = envelope.success === true || (envelope.success === undefined && envelope.code === 200);
    if (!ok || !succeeded) {
      const message = envelope.message?.trim();
      throw new XmaxError(
        XmaxErrorCode.apiError,
        message || "Xmax API request failed",
        {
          apiCode: envelope.code,
          httpStatus: status
        },
      );
    }

    if (envelope.data === undefined || envelope.data === null) {
      throw new XmaxError(
        XmaxErrorCode.apiError,
        "Server returned invalid response data",
        { httpStatus: status },
      );
    }

    return envelope.data;
  }

  /**
   * Converts transport failures to SDK errors.
   */
  private static transportError(
    error: unknown
  ): XmaxError {
    if (error instanceof XmaxError) {
      return error;
    }
    if (error instanceof DOMException && error.name === "TimeoutError") {
      return new XmaxError(
        XmaxErrorCode.timeout,
        "API request timed out"
      );
    }
    if (error instanceof DOMException && error.name === "AbortError") {
      return new XmaxError(
        XmaxErrorCode.cancelled,
        "API request was cancelled"
      );
    }

    const message =
      error instanceof Error && error.message.trim().length > 0
        ? error.message.trim()
        : String(error);
    return new XmaxError(
      XmaxErrorCode.networkError,
      `HTTP request failed: ${message}`,
    );
  }

  /**
   * Logs a failed API request.
   */
  private logFailure(
    method: ApiMethod,
    path: string,
    error: XmaxError,
    startedAt: number,
  ): void {
    XmaxLogger.api.error(
      () =>
        `API 请求失败 (API Request Failed)\n` +
        `└─ ${method} ${path} · ${Date.now() - startedAt}ms\n` +
        `└─ ${XmaxLogger.localized("原因：", "Reason: ")}${error.message}`,
    );
  }
}
