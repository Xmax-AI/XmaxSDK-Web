//
//  EncodingControlling.ts
//  XmaxSDK
//
//  Author: 翁跃庭 (Yueting Weng)
//  GitHub: https://github.com/Xmax-AI/XmaxSDK-Web
//
//  Copyright (c) 2026 XMAX.AI PTE. LTD.
//

import type { RealtimeVideoFormat } from "../../Service/Realtime/RealtimeVideoFormat";

/**
 * RTC video-encoding configuration from realtime formats.
 */
export interface EncodingControlling {

  /**
   * Configures encoding from a video format.
   *
   * @throws Rejects for an invalid format or bitrate range, or RTC configuration failure.
   */
  configure(
    videoFormat: RealtimeVideoFormat
  ): Promise<void>;

  /**
   * Updates frame rate while retaining other resolved settings and returns the successfully applied
   * complete format.
   */
  updateFrameRate(
    fps: number
  ): Promise<RealtimeVideoFormat>;
}
