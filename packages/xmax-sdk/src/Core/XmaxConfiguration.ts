//
//  XmaxConfiguration.ts
//  XmaxSDK
//
//  Author: 翁跃庭 (Yueting Weng)
//  GitHub: https://github.com/Xmax-AI/XmaxSDK-Web
//
//  Copyright (c) 2026 XMAX.AI PTE. LTD.
//

import { XmaxError, XmaxErrorCode } from "../Foundation/Errors/XmaxError";
import { XmaxLoggerOption } from "../Foundation/Logging/XmaxLogger";
import { XmaxEnvironment } from "../Foundation/Runtime/XmaxEnvironment";

/**
 * Client authentication, service environment, and logging options.
 */
export interface XmaxConfigurationInit {

  /**
   * The API key used to access Xmax services.
   */
  apiKey: string;

  /**
   * The service environment; defaults to the China environment.
   */
  environment?: XmaxEnvironment;

  /**
   * The enabled log categories; logging is disabled by default.
   */
  loggerOptions?: XmaxLoggerOption;
}

/**
 * The configuration shared by XmaxSDK services.
 */
export class XmaxConfiguration {

  /**
   * The API key used to access Xmax services.
   */
  readonly apiKey: string;

  /**
   * The service environment, which also selects Chinese or English log details.
   */
  readonly environment: XmaxEnvironment;

  /**
   * The enabled log categories; logging is disabled by default.
   */
  readonly loggerOptions: XmaxLoggerOption;

  /**
   * Creates a client configuration. Call validate() to check its validity.
   */
  constructor(
    init: XmaxConfigurationInit
  ) {
    this.apiKey = init.apiKey.trim();
    this.environment = init.environment ?? XmaxEnvironment.china;
    this.loggerOptions = init.loggerOptions ?? XmaxLoggerOption.none;
  }

  /**
   * Validates the client configuration.
   *
   * @throws An XmaxError if the API key is empty.
   */
  validate(): void {
    if (this.apiKey.length === 0) {
      throw new XmaxError(
        XmaxErrorCode.invalidAPIKey,
        "API key cannot be empty",
      );
    }
  }
}
