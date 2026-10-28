//
//  RealtimeTiming.ts
//  XmaxSDK
//
//  Author: 翁跃庭 (Yueting Weng)
//  GitHub: https://github.com/Xmax-AI/XmaxSDK-Web
//
//  Copyright (c) 2026 XMAX.AI PTE. LTD.
//

import type {
  RealtimeTiming as RealtimeTimingSnapshot,
  RealtimeTimingListener,
} from "../../Service/Realtime/RealtimeTiming";
import { XmaxLogger, XmaxLoggerOption } from "../../Foundation/Logging/XmaxLogger";

/**
 * Observes a media source's initial startup and logs performance after render warmup. Does not commit
 * lifecycle state or control generation waits.
 *
 * @internal
 */
export class RealtimeTiming {

  /**
   * The immutable startup timing snapshot.
   */
  private snapshot: RealtimeTimingSnapshot = Object.freeze({});

  /**
   * The app's startup timing listener.
   */
  private listener?: RealtimeTimingListener;

  /**
   * The revision identifying the current measurement cycle.
   */
  private sequence = 0;

  /**
   * Whether the current cycle still accepts measurements.
   */
  private active = false;

  /**
   * The startup origin on the monotonic clock, in milliseconds.
   */
  private startedAt = 0;

  /**
   * Sets the listener and immediately replays the snapshot; undefined removes it.
   */
  setListener(
    listener?: RealtimeTimingListener
  ): void {
    this.listener = listener;
    this.notify();
  }

  /**
   * Resets startup timing and returns a one-shot camera-creation completion callback.
   */
  startCamera(): () => void {
    this.start();
    return this.measure(
      "cameraMs",
      this.startedAt
    );
  }

  /**
   * Starts a new measurement cycle. Non-camera sources do not record camera duration.
   */
  start(): void {
    this.sequence += 1;
    this.active = true;
    this.startedAt = performance.now();
    this.snapshot = Object.freeze({});

    this.notify();
  }

  /**
   * Starts measuring media-permission confirmation and returns its completion callback.
   */
  startPermission(): () => void {
    return this.measure(
      "permissionMs",
      performance.now()
    );
  }

  /**
   * Starts timing session creation.
   */
  startSession(): () => void {
    return this.measure(
      "sessionMs",
      performance.now()
    );
  }

  /**
   * Starts timing the RTC adapter's room-join call.
   */
  startRtcJoin(): () => void {
    return this.measure(
      "rtcJoinMs",
      performance.now()
    );
  }

  /**
   * Starts timing local publication and returns its completion callback.
   */
  startPublish(): () => void {
    return this.measure(
      "publishMs",
      performance.now()
    );
  }

  /**
   * Starts waiting for the first remote frame submitted to the compositor, excluding render warmup.
   */
  startFirstFrame(): () => void {
    return this.measure(
      "firstFrameMs",
      performance.now()
    );
  }

  /**
   * Starts render warmup after the first frame and records warmup and total duration when completed,
   * excluding fade-in.
   */
  startRenderWarmup(): () => void {
    return this.measure(
      "renderWarmupMs",
      performance.now()
    );
  }

  /**
   * Freezes completed values and invalidates pending callbacks until the next media source.
   */
  cancel(): void {
    this.active = false;
    this.sequence += 1;
  }

  /**
   * Creates a one-shot callback ignored after cycle invalidation or stage completion.
   */
  private measure(
    key: Exclude<keyof RealtimeTimingSnapshot, "totalMs">,
    startedAt: number,
  ): () => void {
    const sequence = this.sequence;
    return () => {
      if (!this.active || sequence !== this.sequence || this.snapshot[key] !== undefined) {
        return;
      }

      const now = performance.now();
      this.snapshot = Object.freeze({
        ...this.snapshot,
        [key]: now - startedAt,
        ...(key === "renderWarmupMs" ? { totalMs: now - this.startedAt } : {}),
      });

      if (key === "renderWarmupMs") {
        const snapshot = this.snapshot;
        XmaxLogger.realtime.info(
          () => this.format(snapshot),
          XmaxLoggerOption.performance
        );
      }

      this.notify();
    };
  }

  /**
   * Formats the startup snapshot, using placeholders for incomplete or disabled stages.
   */
  private format(
    snapshot: RealtimeTimingSnapshot
  ): string {
    const stages = [
      [XmaxLogger.localized(
        "摄像头启动：",
        "Camera Startup: "
      ), snapshot.cameraMs],
      [XmaxLogger.localized(
        "媒体授权：",
        "Media Permission: "
      ), snapshot.permissionMs],
      [XmaxLogger.localized(
        "创建会话：",
        "Session Creation: "
      ), snapshot.sessionMs],
      [XmaxLogger.localized(
        "RTC 进房：",
        "RTC Room Join: "
      ), snapshot.rtcJoinMs],
      [XmaxLogger.localized(
        "发布本地流：",
        "Local Stream Publication: "
      ), snapshot.publishMs],
      [XmaxLogger.localized(
        "首帧到达：",
        "First Frame Arrival: "
      ), snapshot.firstFrameMs],
      [XmaxLogger.localized(
        "渲染预热：",
        "Render Warmup: "
      ), snapshot.renderWarmupMs],
    ] as const;

    return [
      "实时生成启动耗时 (Realtime Generation Startup Timing)",
      `└─ ${XmaxLogger.localized("总耗时：", "Total Duration: ")}${this.duration(snapshot.totalMs)}`,
      ...stages.map((
        [label, duration],
        index
      ) =>
        `   ${index === stages.length - 1 ? "└─" : "├─"} ${label}${this.duration(duration)}`,
      ),
    ].join("\n");
  }

  /**
   * Formats milliseconds to one decimal place, using a placeholder for missing or invalid values.
   */
  private duration(
    milliseconds?: number
  ): string {
    if (milliseconds === undefined || !Number.isFinite(milliseconds) || milliseconds < 0) {
      return "—";
    }

    return `${milliseconds.toFixed(1)} ms`;
  }

  /**
   * Delivers immutable snapshots while isolating synchronous and asynchronous observer failures.
   */
  private notify(): void {
    try {
      // Asynchronous observer failures must not affect the media lifecycle.
      void Promise.resolve(this.listener?.(this.snapshot)).catch(() => { });
    } catch {
      // Synchronous observer failures are isolated as well.
    }
  }
}
