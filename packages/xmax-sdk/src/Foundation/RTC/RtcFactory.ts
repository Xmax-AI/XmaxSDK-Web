//
//  RtcFactory.ts
//  XmaxSDK
//
//  Author: 翁跃庭 (Yueting Weng)
//  GitHub: https://github.com/Xmax-AI/XmaxSDK-Web
//
//  Copyright (c) 2026 XMAX.AI PTE. LTD.
//

import { XmaxEnvironment } from "../Runtime/XmaxEnvironment";
import { AgoraRtcManager } from "./Agora/AgoraRtcManager";
import { RtcProvider } from "./RtcProvider";
import { TrtcRtcManager } from "./TRTC/TrtcRtcManager";
import { VeRtcManager } from "./VeRTC/VeRtcManager";
import type { RtcManaging } from "./RtcManaging";
import { XmaxError, XmaxErrorCode } from "../Errors/XmaxError";

/**
 * Creates an adapter from the configured RTC provider without loading its runtime during construction.
 */
export function createRtcManager(
  provider: RtcProvider,
  environment: XmaxEnvironment
): RtcManaging {
  switch (provider) {
    case RtcProvider.trtc:
      return new TrtcRtcManager();
    case RtcProvider.agora:
      return new AgoraRtcManager({ environment });
    case RtcProvider.vertc:
      return new VeRtcManager();
    default:
      throw new XmaxError(
        XmaxErrorCode.invalidConfiguration,
        "Unsupported RTC provider"
      );
  }
}
