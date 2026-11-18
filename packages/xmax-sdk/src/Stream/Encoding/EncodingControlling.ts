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
   * @returns False if the browser silently ignored the requested sender limits.
   * @throws Rejects for an invalid format or bitrate range, or RTC configuration failure.
   */
  configure(
    videoFormat: RealtimeVideoFormat
  ): Promise<void | false>;

  /**
   * Updates frame rate while retaining other resolved settings and returns the successfully applied
   * complete format, or undefined if the browser silently ignored the update.
   */
  updateFrameRate(
    fps: number
  ): Promise<RealtimeVideoFormat | undefined>;
}
