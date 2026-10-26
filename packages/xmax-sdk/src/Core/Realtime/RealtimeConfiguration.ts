//
//  RealtimeConfiguration.ts
//  XmaxSDK
//
//  Author: 翁跃庭 (Yueting Weng)
//  GitHub: https://github.com/Xmax-AI/XmaxSDK-Web
//
//  Copyright (c) 2026 XMAX.AI PTE. LTD.
//

import { supportedRtcProviders, type RealtimeModelName } from "../../Service/Realtime/RealtimeModel";
import { RtcProvider } from "../../Foundation/RTC/RtcProvider";
import { XmaxError, XmaxErrorCode } from "../../Foundation/Errors/XmaxError";

/**
 * 创建实时 Manager 所需的业务配置。
 */
export class RealtimeConfiguration {

  /**
   * 实时生成使用的模型；未知名称原样透传到测试环境，媒体与 RTC 默认配置同 X2.1。
   */
  readonly model: RealtimeModelName;

  /**
   * 实时连接使用的 RTC 提供方，默认取模型支持列表的首项，创建后不可切换。
   */
  readonly provider: RtcProvider;

  /**
   * 是否默认请求开启远端生成画面的插帧，默认 false。
   */
  readonly isFrameInterpolationEnabled: boolean;

  /**
   * 是否自动调整上下行档位，默认 true。关闭时从 L1 启动且不读写历史档位，仍支持手动调档。
   */
  readonly isAdaptiveQualityEnabled: boolean;

  /**
   * 补全 RTC、插帧和自动调档默认值，并校验模型名称与 RTC 提供方配置。
   */
  constructor(
    init: {
      model: RealtimeModelName;
      provider?: RtcProvider;
      isFrameInterpolationEnabled?: boolean;
      isAdaptiveQualityEnabled?: boolean;
    }
  ) {
    const providers = supportedRtcProviders(init.model);
    this.provider = init.provider ?? providers[0]!;
    if (!Object.values(RtcProvider).includes(this.provider)) {
      throw new XmaxError(XmaxErrorCode.invalidConfiguration, "Unsupported RTC provider");
    }
    if (!providers.includes(this.provider)) {
      throw new XmaxError(
        XmaxErrorCode.invalidConfiguration,
        `Model ${init.model} does not support RTC provider ${this.provider}`,
      );
    }
    this.model = init.model;

    this.isFrameInterpolationEnabled = init.isFrameInterpolationEnabled ?? false;
    this.isAdaptiveQualityEnabled = init.isAdaptiveQualityEnabled ?? true;
  }
}
