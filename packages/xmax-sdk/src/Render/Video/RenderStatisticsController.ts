//
//  RenderStatisticsController.ts
//  XmaxSDK
//
//  Author: 翁跃庭 (Yueting Weng)
//  GitHub: https://github.com/Xmax-AI/XmaxSDK-Web
//
//  Copyright (c) 2026 XMAX.AI PTE. LTD.
//

import type { VideoRenderStatistics } from "./VideoRenderStatistics";

/**
 * Observes browser-presented video frames and owns one view's sampling window and callback without
 * controlling playback.
 *
 * @internal
 */
export class RenderStatisticsController {

  /**
   * The presentation-statistics callback.
   */
  handler?: (
    statistics?: VideoRenderStatistics
  ) => void;

  /**
   * The periodic sampling timer.
   */
  private timer?: ReturnType<typeof setInterval>;

  /**
   * The pending video-frame observation handle.
   */
  private callbackID?: number;

  /**
   * The measurement revision rejecting obsolete callbacks.
   */
  private sequence = 0;

  /**
   * The sampling-window start on the monotonic clock.
   */
  private startedAt = 0;

  /**
   * The original-frame count in the current window.
   */
  private originalFrames = 0;

  /**
   * The previous cumulative presented-frame count reported by the browser.
   */
  private previousPresentedFrames?: number;

  /**
   * Creates an observer for a video element; collection begins only after start().
   */
  constructor(
    private readonly video: HTMLVideoElement
  ) { }

  /**
   * Collects independently of panel visibility, without allocating a timer when no observer exists.
   */
  start(): void {
    if (this.timer !== undefined ||
      (!this.video.srcObject && !this.video.getAttribute("src")) ||
      !this.handler ||
      typeof this.video.requestVideoFrameCallback !== "function") {
      return;
    }

    this.reset();
    const sequence = this.sequence;
    const observe = () => {
      this.callbackID = this.video.requestVideoFrameCallback((
        _now,
        metadata
      ) => {
        if (sequence !== this.sequence) {
          return;
        }
        this.callbackID = undefined;
        if (!document.hidden) {
          this.recordVideoFrames(metadata.presentedFrames);
        } else {
          // Do not count hidden-page frames in a subsequent visible sampling window.
          this.previousPresentedFrames = undefined;
        }
        observe();
      });
    };
    observe();
    this.timer = setInterval(
      () => this.sample(),
      1_000
    );
  }

  /**
   * Counts cumulative presented-frame increments, including frames presented between callbacks.
   */
  private recordVideoFrames(
    presentedFrames: number
  ): void {
    if (!Number.isSafeInteger(presentedFrames) || presentedFrames < 0) {
      this.previousPresentedFrames = undefined;
      return;
    }

    const previous = this.previousPresentedFrames;
    this.previousPresentedFrames = presentedFrames;

    // After first observation or counter reset, count only the current frame rather than historical playback.
    if (previous === undefined || presentedFrames < previous) {
      this.originalFrames += presentedFrames > 0 ? 1 : 0;
      return;
    }

    this.originalFrames += presentedFrames - previous;
  }

  /**
   * Stops sampling and frame observation, invalidates queued callbacks, and clears public statistics.
   */
  stop(): void {
    this.sequence++;
    clearInterval(this.timer);
    this.timer = undefined;
    if (this.callbackID !== undefined) {
      this.video.cancelVideoFrameCallback(this.callbackID);
    }
    this.callbackID = undefined;
    this.reset();
  }

  /**
   * Resets the sampling window to exclude media from previous bindings.
   */
  private reset(): void {
    this.startedAt = performance.now();
    this.originalFrames = 0;
    this.previousPresentedFrames = undefined;
    this.notify(undefined);
  }

  /**
   * Computes rate over actual elapsed time, reporting zero without new frames and suppressing
   * hidden-page samples.
   */
  private sample(): void {
    const now = performance.now();
    const seconds = (now - this.startedAt) / 1000;
    if (document.hidden || seconds <= 0) {
      this.reset();
      return;
    }

    const statistics: VideoRenderStatistics = Object.freeze({
      source: "video",
      frameRate: this.originalFrames / seconds,
      originalFrameRate: this.originalFrames / seconds,
    });
    this.startedAt = now;
    this.originalFrames = 0;
    this.notify(statistics);
  }

  /**
   * Isolates app callback failures from playback and subsequent sampling.
   */
  private notify(
    statistics?: VideoRenderStatistics
  ): void {
    try {
      this.handler?.(statistics);
    } catch { }
  }
}
