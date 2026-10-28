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
 * The configuration used to create a realtime manager.
 */
export class RealtimeConfiguration {

  /**
   * The generation model. Custom IDs are forwarded unchanged to the development service and use X2.1
   * media and RTC defaults.
   */
  readonly model: RealtimeModelName;

  /**
   * The RTC provider, defaulting to the first provider supported by the model. It cannot change after
   * creation.
   */
  readonly provider: RtcProvider;

  /**
   * Whether to adapt uplink and downlink quality automatically; defaults to true. When disabled, startup
   * uses L1 without reading or updating quality history. Manual adjustment remains available.
   */
  readonly isAdaptiveQualityEnabled: boolean;

  /**
   * Creates a realtime configuration and validates the model and RTC provider.
   */
  constructor(
    init: {
      model: RealtimeModelName;
      provider?: RtcProvider;
      isAdaptiveQualityEnabled?: boolean;
    }
  ) {
    const providers = supportedRtcProviders(init.model);
    this.provider = init.provider ?? providers[0]!;
    if (!Object.values(RtcProvider).includes(this.provider)) {
      throw new XmaxError(
        XmaxErrorCode.invalidConfiguration,
        "Unsupported RTC provider"
      );
    }
    if (!providers.includes(this.provider)) {
      throw new XmaxError(
        XmaxErrorCode.invalidConfiguration,
        `Model ${init.model} does not support RTC provider ${this.provider}`,
      );
    }
    this.model = init.model;

    this.isAdaptiveQualityEnabled = init.isAdaptiveQualityEnabled ?? true;
  }
}
