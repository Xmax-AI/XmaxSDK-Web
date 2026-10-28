//
//  RealtimeMediaFrameDispatcher.ts
//  XmaxSDK
//
//  Author: 翁跃庭 (Yueting Weng)
//  GitHub: https://github.com/Xmax-AI/XmaxSDK-Web
//
//  Copyright (c) 2026 XMAX.AI PTE. LTD.
//

import { XmaxLogger } from "../../Foundation/Logging/XmaxLogger";
import type { RealtimeMediaFrame, RealtimeMediaFrameListener } from "../../Service/Realtime/RealtimeMediaFrame";

/**
 * A bounded delivery queue that never blocks producers or retains frames already delivered to your app.
 */
export class RealtimeMediaFrameDispatcher {

  /**
   * The active media-frame listener.
   */
  private listener?: RealtimeMediaFrameListener;

  /**
   * The queued packets and their estimated memory costs.
   */
  private queue: Array<{
    packet: RealtimeMediaFrame;
    bytes: number
  }> = [];

  /**
   * The total queued byte count.
   */
  private bytes = 0;

  /**
   * The pending asynchronous delivery timer.
   */
  private timer?: ReturnType<typeof setTimeout>;

  /**
   * The tracks whose next packet requires a discontinuity marker.
   */
  private readonly discontinuous = new Set<"audio" | "video">(["audio", "video"]);

  /**
   * Whether an app-observer failure has been reported for this subscription.
   */
  private reportedError = false;

  /**
   * Creates a queue bounded by packet count and bytes to prevent unbounded observer backlogs.
   */
  constructor(
    private readonly maximumPackets = 256,
    private readonly maximumBytes = 32 * 1024 * 1024,
  ) { }

  /**
   * Replaces or removes the listener and discards packets queued for the previous observer.
   */
  setListener(
    listener?: RealtimeMediaFrameListener
  ): void {
    this.reset();
    this.listener = listener;
    this.reportedError = false;
  }

  /**
   * Clears queued media while retaining the listener and borrowed RTC tracks.
   */
  reset(): void {
    clearTimeout(this.timer);
    this.timer = undefined;
    for (const item of this.queue) {
      this.release(item.packet);
    }
    this.queue = [];
    this.bytes = 0;
    this.discontinuous.add("audio");
    this.discontinuous.add("video");
  }

  /**
   * Enqueues media within memory bounds, releasing undelivered video on overflow and marking subsequent
   * discontinuity without compressing timestamps.
   */
  dispatch(
    packet: RealtimeMediaFrame
  ): void {
    const type = packet.content.type;
    const bytes = packet.content.type === "audio" ? packet.content.frame.data.byteLength
      : packet.content.frame.frame.displayWidth * packet.content.frame.frame.displayHeight * 4;
    if (!this.listener || this.queue.length >= this.maximumPackets || bytes > this.maximumBytes - this.bytes) {
      this.release(packet);
      this.discontinuous.add(type);
      return;
    }
    this.queue.push({
      packet: Object.freeze({
        ...packet,
        isDiscontinuous: packet.isDiscontinuous || this.discontinuous.has(type)
      }),
      bytes,
    });
    this.discontinuous.delete(type);
    this.bytes += bytes;
    this.timer ??= setTimeout(
      () => this.deliver(),
      0
    );
  }

  /**
   * Delivers bounded batches and stops invoking an observer that replaces or removes itself.
   */
  private deliver(): void {
    this.timer = undefined;
    for (let count = 0; count < 16 && this.queue.length; count++) {
      const item = this.queue.shift()!;
      this.bytes -= item.bytes;
      const listener = this.listener;
      if (!listener) {
        this.release(item.packet);
        continue;
      }
      try {
        void Promise.resolve(listener(item.packet)).catch(error => {
          this.release(item.packet);
          this.report(error);
        });
      } catch (error) {
        this.release(item.packet);
        this.report(error);
      }
    }
    if (this.queue.length) {
      this.timer ??= setTimeout(
        () => this.deliver(),
        0
      );
    }
  }

  /**
   * Releases only undelivered frames; successfully delivered video belongs to your app.
   */
  private release(
    packet: RealtimeMediaFrame
  ): void {
    if (packet.content.type === "video") {
      packet.content.frame.frame.close();
    }
  }

  /**
   * Isolates observer failures and logs once per subscription.
   */
  private report(
    error: unknown
  ): void {
    if (this.reportedError) {
      return;
    }
    this.reportedError = true;
    XmaxLogger.render.warning(() => `Remote media frame listener failed: ${String(error)}`);
  }
}
