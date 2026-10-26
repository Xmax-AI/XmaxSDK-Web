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
 * 有界媒体交付队列；不阻塞生产者，不保存已交给接入方的帧。
 */
export class RealtimeMediaFrameDispatcher {

  /**
   * 回调及队列资源
   */
  private listener?: RealtimeMediaFrameListener;

  /**
   * 待交付媒体及估算内存。
   */
  private queue: Array<{ packet: RealtimeMediaFrame; bytes: number }> = [];

  /**
   * 队列占用总字节数。
   */
  private bytes = 0;

  /**
   * 异步交付的调度句柄。
   */
  private timer?: ReturnType<typeof setTimeout>;

  /**
   * 各轨下一包需要标记不连续。
   */
  private readonly discontinuous = new Set<"audio" | "video">(["audio", "video"]);

  /**
   * 当前监听周期是否已报告接入方异常。
   */
  private reportedError = false;

  /**
   * 使用帧数和字节数双重限制，避免接入方处理变慢时无限积压。
   */
  constructor(
    private readonly maximumPackets = 256,
    private readonly maximumBytes = 32 * 1024 * 1024,
  ) {}

  /**
   * 替换或清除监听器，并丢弃旧监听器的待交付媒体。
   */
  setListener(listener?: RealtimeMediaFrameListener): void {
    this.reset();
    this.listener = listener;
    this.reportedError = false;
  }

  /**
   * 清空旧绑定的媒体，保留监听器，不停止借用的 RTC 轨道。
   */
  reset(): void {
    clearTimeout(this.timer);
    this.timer = undefined;
    for (const item of this.queue) this.release(item.packet);
    this.queue = [];
    this.bytes = 0;
    this.discontinuous.add("audio");
    this.discontinuous.add("video");
  }

  /**
   * 接收一包媒体；超限时释放未交付的视频，下一包标记不连续，不压缩时间戳。
   */
  dispatch(packet: RealtimeMediaFrame): void {
    const type = packet.content.type;
    const bytes = packet.content.type === "audio" ? packet.content.frame.data.byteLength
      : packet.content.frame.frame.displayWidth * packet.content.frame.frame.displayHeight * 4;
    if (!this.listener || this.queue.length >= this.maximumPackets || bytes > this.maximumBytes - this.bytes) {
      this.release(packet);
      this.discontinuous.add(type);
      return;
    }
    this.queue.push({
      packet: Object.freeze({ ...packet, isDiscontinuous: packet.isDiscontinuous || this.discontinuous.has(type) }), bytes,
    });
    this.discontinuous.delete(type);
    this.bytes += bytes;
    this.timer ??= setTimeout(() => this.deliver(), 0);
  }

  /**
   * 分批交付，监听器内部替换或移除自身时不再调用旧回调。
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
    if (this.queue.length) this.timer ??= setTimeout(() => this.deliver(), 0);
  }

  /**
   * 仅释放尚未成功交付的媒体，正常返回的帧由接入方释放。
   */
  private release(packet: RealtimeMediaFrame): void {
    if (packet.content.type === "video") packet.content.frame.frame.close();
  }

  /**
   * 隔离观察者异常，同一监听周期只输出一次日志。
   */
  private report(error: unknown): void {
    if (this.reportedError) return;
    this.reportedError = true;
    XmaxLogger.render.warning(() => `Remote media frame listener failed: ${String(error)}`);
  }
}
