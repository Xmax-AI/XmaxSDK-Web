//
//  RtcEventListener.ts
//  XmaxSDK
//
//  Author: 翁跃庭 (Yueting Weng)
//  GitHub: https://github.com/Xmax-AI/XmaxSDK-Web
//
//  Copyright (c) 2026 XMAX.AI PTE. LTD.
//

import type { DownlinkVideoStatistics, UplinkVideoStatisticsListener } from "./VideoStatistics";
import type { RealtimeNetworkQualityListener } from "./NetworkStatistics";

/**
 * Receives RTC media events and room signaling. Room messages use TRTC custom messages, Agora
 * DataStream, or VeRTC text messages, not SEI.
 */
export interface RtcEventListener {

  /**
   * Notifies observers that a user's original audio track was installed, replaced, or removed.
   */
  onRemoteAudioTrackChanged?: (
    userID: string
  ) => void;

  /**
   * Requests refreshed credentials before the RTC token expires.
   */
  onTokenWillExpire?: () => void;

  /**
   * Requests refreshed credentials after token expiration to recover the room connection.
   */
  onTokenExpired?: () => void;

  /**
   * Reports rejoining the same room, clearing old subscription bindings while retaining the task and
   * volume settings.
   */
  onRoomRejoining?: () => void;

  /**
   * Reports an RTC runtime error without credentials.
   */
  onError?: (
    error: import("../Errors/XmaxError").XmaxError
  ) => void;

  /**
   * Reports local uplink and downlink quality independently of performance logging.
   */
  onNetworkStatistics?: RealtimeNetworkQualityListener;

  /**
   * Reports local main-stream video statistics independently of performance logging.
   */
  onLocalVideoStatistics?: UplinkVideoStatisticsListener;

  /**
   * Reports all remote main-stream statistics for one sample; an empty list means no available
   * statistics.
   */
  onRemoteVideoStatistics?: (
    statistics: readonly DownlinkVideoStatistics[]
  ) => void;

  /**
   * Reports main-video publication changes for a remote user.
   */
  onRemoteVideoPublished(
    userID: string,
    published: boolean
  ): void;

  /**
   * Receives UTF-8 room messages, with TRTC messages already filtered to cmdId 1.
   */
  onCustomMessageReceived(
    userID: string,
    message: string
  ): void;
}
