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
 * SDK 的身份、环境和日志选项。
 */
export interface XmaxConfigurationInit {

  /**
   * 调用 Xmax 服务使用的 API Key。
   */
  apiKey: string;

  /**
   * SDK 连接的服务环境；默认为国内环境。
   */
  environment?: XmaxEnvironment;

  /**
   * SDK 输出的日志类型；默认为不输出日志。
   */
  loggerOptions?: XmaxLoggerOption;
}

/**
 * SDK 全局配置。
 */
export class XmaxConfiguration {

  /**
   * 调用 Xmax 服务使用的 API Key。
   */
  readonly apiKey: string;

  /**
   * SDK 连接的服务环境，同时决定日志细项语言：国内为中文，海外为英文。
   */
  readonly environment: XmaxEnvironment;

  /**
   * SDK 输出的日志类型；默认为不输出日志。
   */
  readonly loggerOptions: XmaxLoggerOption;

  /**
   * 清理 API Key 首尾空白并补全环境和日志默认值；有效性检查由 validate 执行。
   */
  constructor(
    init: XmaxConfigurationInit
  ) {
    this.apiKey = init.apiKey.trim();
    this.environment = init.environment ?? XmaxEnvironment.china;
    this.loggerOptions = init.loggerOptions ?? XmaxLoggerOption.none;
  }

  /**
   * 校验全局配置。
   * @throws API Key 为空时抛出 `XmaxError`。
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
