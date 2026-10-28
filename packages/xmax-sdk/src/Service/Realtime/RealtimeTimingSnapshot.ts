//
//  RealtimeTimingSnapshot.ts
//  XmaxSDK
//
//  Author: 翁跃庭 (Yueting Weng)
//  GitHub: https://github.com/Xmax-AI/XmaxSDK-Web
//
//  Copyright (c) 2026 XMAX.AI PTE. LTD.
//

/**
 * Durations for one media startup, in milliseconds; undefined marks unfinished or disabled stages. A new
 * media source resets the snapshot. Failures, closure, and disconnection retain completed values.
 * Preview alone produces no first-frame or total duration; waiting before manually starting generation
 * contributes to the total.
 */
export interface RealtimeTiming {

  /**
   * The time from opening the camera until its stream is created, including permission waits.
   */
  readonly cameraMs?: number;

  /**
   * The time to confirm camera and microphone permissions, including a displayed permission prompt.
   * Omitted when permission is denied or the browser cannot observe the decision.
   */
  readonly permissionMs?: number;

  /**
   * The time spent creating the business session.
   */
  readonly sessionMs?: number;

  /**
   * The RTC adapter's room-join duration, excluding message setup, heartbeat startup, warmup waits, and
   * local publication.
   */
  readonly rtcJoinMs?: number;

  /**
   * The time spent publishing local media to the RTC room.
   */
  readonly publishMs?: number;

  /**
   * The time from starting generation signaling until the first remote frame is submitted to the
   * compositor, excluding render warmup.
   */
  readonly firstFrameMs?: number;

  /**
   * The actual wait from the first remote frame until render warmup completes, excluding fade-in.
   */
  readonly renderWarmupMs?: number;

  /**
   * The elapsed time from opening the camera until remote warmup completes and fade-in starts, not the
   * sum of the stages.
   */
  readonly totalMs?: number;
}

/**
 * Receives the full snapshot when a stage completes. Browsers without video-frame callbacks approximate
 * the first frame using the playing event.
 */
export type RealtimeTimingListener = (
  timing: RealtimeTiming
) => void;
