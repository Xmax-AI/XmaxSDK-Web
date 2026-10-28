//
//  XmaxError.ts
//  XmaxSDK
//
//  Author: 翁跃庭 (Yueting Weng)
//  GitHub: https://github.com/Xmax-AI/XmaxSDK-Web
//
//  Copyright (c) 2026 XMAX.AI PTE. LTD.
//

/**
 * The error codes exposed by XmaxSDK.
 */
export enum XmaxErrorCode {

  /**
   * The API key is missing or empty.
   */
  invalidAPIKey = "INVALID_API_KEY",

  /**
   * Arguments, configuration, or lifecycle state do not permit the operation.
   */
  invalidConfiguration = "INVALID_CONFIGURATION",

  /**
   * An unexpected SDK failure without a more specific category.
   */
  internalError = "INTERNAL_ERROR",

  /**
   * The network is unavailable, connection failed, or an HTTP request could not complete.
   */
  networkError = "NETWORK_ERROR",

  /**
   * The API reported a business failure or its response could not be parsed.
   */
  apiError = "API_ERROR",

  /**
   * Session information is missing, the session closed, or its heartbeat is invalid.
   */
  sessionError = "SESSION_ERROR",

  /**
   * An RTC engine, room, transport, or rendering-binding failure.
   */
  rtcError = "RTC_ERROR",

  /**
   * A local-media read, decode, synchronization, or frame-processing failure.
   */
  mediaError = "MEDIA_ERROR",

  /**
   * Camera permission was not granted.
   */
  cameraPermissionDenied = "CAMERA_PERMISSION_DENIED",

  /**
   * @deprecated Retained for compatibility. Fixed camera warmup no longer throws this error.
   */
  cameraExposureTimeout = "CAMERA_EXPOSURE_TIMEOUT",

  /**
   * Microphone permission was not granted.
   */
  microphonePermissionDenied = "MICROPHONE_PERMISSION_DENIED",

  /**
   * A file or binary upload failed.
   */
  uploadError = "UPLOAD_ERROR",

  /**
   * A remote-file download failed.
   */
  downloadError = "DOWNLOAD_ERROR",

  /**
   * The image failed content-safety checks.
   */
  unsafeImage = "UNSAFE_IMAGE",

  /**
   * The operation was cancelled by a lifecycle transition or your app.
   */
  cancelled = "CANCELLED",

  /**
   * The connection, room event, or generation result exceeded its wait limit.
   */
  timeout = "TIMEOUT",
}

/**
 * Receives normalized errors reported by internal SDK components.
 */
export type XmaxErrorListener = (
  error: XmaxError
) => void;

/**
 * A normalized error thrown or delivered by XmaxSDK.
 */
export class XmaxError extends Error {

  /**
   * The SDK error category.
   */
  readonly code: XmaxErrorCode;

  /**
   * The API business error code, when supplied by an API failure.
   */
  readonly apiCode?: number;

  /**
   * The HTTP status code, when a response was received.
   */
  readonly httpStatus?: number;

  /**
   * Creates an SDK error.
   *
   * @param code - The SDK error category.
   * @param message - The readable error description.
   * @param options - Optional API business and HTTP status codes.
   */
  constructor(
    code: XmaxErrorCode,
    message: string,
    options?: {
      apiCode?: number;
      httpStatus?: number
    },
  ) {
    super(message);
    this.name = "XmaxError";
    this.code = code;
    this.apiCode = options?.apiCode;
    this.httpStatus = options?.httpStatus;
  }

  /**
   * Normalizes an unknown error, returning existing XmaxError instances unchanged.
   *
   * @param error - The error to normalize.
   * @returns An SDK error suitable for rejection or callback delivery.
   */
  static from(
    error: unknown
  ): XmaxError {
    if (error instanceof XmaxError) {
      return error;
    }
    const message =
      error instanceof Error && error.message.trim().length > 0
        ? error.message.trim()
        : String(error);
    return new XmaxError(
      XmaxErrorCode.internalError,
      message
    );
  }
}
