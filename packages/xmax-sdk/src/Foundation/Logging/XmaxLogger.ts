//
//  XmaxLogger.ts
//  XmaxSDK
//
//  Author: 翁跃庭 (Yueting Weng)
//  GitHub: https://github.com/Xmax-AI/XmaxSDK-Web
//
//  Copyright (c) 2026 XMAX.AI PTE. LTD.
//

import { XmaxEnvironment } from "../../Core/XmaxEnvironment";

/**
 * Log-category flags that can be combined as a bitmask.
 */
export enum XmaxLoggerOption {

  /**
   * Disables all SDK logs.
   */
  none = 0,

  /**
   * Business logs for rooms, API requests, realtime operations, and storage.
   */
  business = 1 << 0,

  /**
   * Startup, RTC network-quality, and media statistics sent to console.info.
   */
  performance = 1 << 1,

  /**
   * Enables all SDK logs.
   */
  all = business | performance,
}

/**
 * The severity of an SDK log message.
 */
type XmaxLogLevel = "debug" | "info" | "warning" | "error";

/**
 * Output settings shared by all logger categories.
 */
interface XmaxLoggerState {

  /**
   * The enabled log categories.
   */
  options: XmaxLoggerOption;

  /**
   * The service environment selecting the language of log details.
   */
  environment: XmaxEnvironment;
}

/**
 * The output-category and language settings shared by all loggers.
 */
const state: XmaxLoggerState = {
  options: XmaxLoggerOption.none,
  environment: XmaxEnvironment.china,
};

/**
 * Browser console methods indexed by log severity.
 */
const CONSOLE_METHOD: Record<XmaxLogLevel, "debug" | "info" | "warn" | "error"> = {
  debug: "debug",
  info: "info",
  warning: "warn",
  error: "error",
};

/**
 * The blue-and-white Xmax console badge style.
 */
const BRAND_BADGE_STYLE = "background:#2563eb;color:#fff;border-radius:3px;padding:1px 4px;font-weight:600;";

/**
 * The category badge style, visually distinct from the brand badge.
 */
const CATEGORY_BADGE_STYLE = "background:#475569;color:#fff;border-radius:3px;padding:1px 4px;font-weight:600;";

/**
 * Writes categorized console messages with the Xmax prefix.
 *
 * Never supply API keys, tokens, secrets, Authorization values, or complete sensitive responses.
 */
export class XmaxLogger {

  /**
   * The realtime business logger.
   */
  static readonly realtime = new XmaxLogger("Realtime");

  /**
   * The RTC engine, room, and media-transport logger.
   */
  static readonly rtc = new XmaxLogger("RTC");

  /**
   * The local-media preparation and cleanup logger.
   */
  static readonly media = new XmaxLogger("Media");

  /**
   * The API request and response logger.
   */
  static readonly api = new XmaxLogger("API");

  /**
   * The file upload and download logger.
   */
  static readonly storage = new XmaxLogger("Storage");

  /**
   * The room-message and heartbeat logger.
   */
  static readonly room = new XmaxLogger("Room");

  /**
   * The publication, subscription, and generation-signaling logger.
   */
  static readonly stream = new XmaxLogger("Stream");

  /**
   * The video-view and rendering-pipeline logger.
   */
  static readonly render = new XmaxLogger("Render");

  /**
   * The touch-sampling and trajectory logger.
   */
  static readonly interaction = new XmaxLogger("Interaction");

  /**
   * The camera and microphone permission logger.
   */
  static readonly permission = new XmaxLogger("Permission");

  /**
   * The category displayed in this logger's badge.
   */
  private readonly category: string;

  /**
   * Creates a categorized logger sharing the global output settings.
   */
  private constructor(
    category: string
  ) {
    this.category = category;
  }

  /**
   * Replaces global logging categories and language settings.
   *
   * @param options - The enabled-category bitmask.
   * @param environment - The environment selecting Chinese or English log details.
   */
  static configure(
    options: XmaxLoggerOption,
    environment: XmaxEnvironment = XmaxEnvironment.china,
  ): void {
    state.options = options;
    state.environment = environment;
  }

  /**
   * Selects localized details while retaining bilingual log titles.
   */
  static localized(
    chinese: string,
    english: string
  ): string {
    return state.environment === XmaxEnvironment.china ? chinese : english;
  }

  /**
   * Checks whether a log category is enabled.
   */
  static isEnabled(
    option: XmaxLoggerOption
  ): boolean {
    return (state.options & option) !== 0;
  }

  /**
   * Writes a debug message.
   */
  debug(
    message: () => string,
    option: XmaxLoggerOption = XmaxLoggerOption.business
  ): void {
    this.log(
      "debug",
      message,
      option
    );
  }

  /**
   * Writes an informational message.
   */
  info(
    message: () => string,
    option: XmaxLoggerOption = XmaxLoggerOption.business
  ): void {
    this.log(
      "info",
      message,
      option
    );
  }

  /**
   * Writes a warning.
   */
  warning(
    message: () => string,
    option: XmaxLoggerOption = XmaxLoggerOption.business
  ): void {
    this.log(
      "warning",
      message,
      option
    );
  }

  /**
   * Writes an error message.
   */
  error(
    message: () => string,
    option: XmaxLoggerOption = XmaxLoggerOption.business
  ): void {
    this.log(
      "error",
      message,
      option
    );
  }

  /**
   * Writes enabled messages without evaluating disabled message factories.
   */
  private log(
    level: XmaxLogLevel,
    message: () => string,
    option: XmaxLoggerOption,
  ): void {
    if (!XmaxLogger.isEnabled(option)) {
      return;
    }

    const text = message();
    if (typeof window !== "undefined" && typeof document !== "undefined") {
      // Pass message text through %s so embedded %c or %s sequences are not interpreted as formatting commands.
      console[CONSOLE_METHOD[level]](
        `%c[Xmax]%c %c[${this.category}]%c\n%s`,
        BRAND_BADGE_STYLE,
        "",
        CATEGORY_BADGE_STYLE,
        "",
        text,
      );
      return;
    }

    // Use a plain-text prefix outside browser documents.
    console[CONSOLE_METHOD[level]](`[Xmax][${this.category}] ${text}`);
  }
}
