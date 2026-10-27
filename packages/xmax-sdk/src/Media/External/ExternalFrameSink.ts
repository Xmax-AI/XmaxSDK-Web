//
//  ExternalFrameSink.ts
//  XmaxSDK
//
//  Author: 翁跃庭 (Yueting Weng)
//  GitHub: https://github.com/Xmax-AI/XmaxSDK-Web
//
//  Copyright (c) 2026 XMAX.AI PTE. LTD.
//

import { XmaxError, XmaxErrorCode } from "../../Foundation/Errors/XmaxError";
import type { ExternalAudioFrameSource } from "../../Foundation/Media/Audio/ExternalAudioFrameSource";
import type { RealtimeExternalAudioFrame } from "../../Foundation/Media/Audio/RealtimeExternalAudioFrame";
import type { RealtimeVideoFormat } from "../../Service/Realtime/RealtimeVideoFormat";
import type { RealtimeExternalFrameSink } from "./RealtimeExternalVideoSource";

/**
 * 校验源时间戳，按共享采样时钟调度帧；解绑后旧 sink 永久失效。
 */
export class ExternalFrameSink implements RealtimeExternalFrameSink {

  /**
   * 绑定状态、连续性和源时间到浏览器时钟的映射
   */
  private active = true;
  private lastVideoTime = -1;
  private anchor?: { source: number; output: number };

  /**
   * 保留下一张待呈现帧和最新后续帧；不能用新帧反复推迟已安排的呈现。
   */
  private pending?: VideoFrame;
  private next?: { frame: VideoFrame; time: number };
  private timer?: ReturnType<typeof setTimeout>;

  /**
   * 注入固定输入和媒体规格、画布输出、可选音频及不可恢复错误通知。
   */
  constructor(
    readonly videoFormat: RealtimeVideoFormat,
    private readonly sourceFormat: RealtimeVideoFormat,
    private readonly context: CanvasRenderingContext2D,
    private readonly track: CanvasCaptureMediaStreamTrack,
    private readonly audio: ExternalAudioFrameSource | undefined,
    private readonly onError: (error: XmaxError) => void,
  ) {}

  /**
   * 断开时继续接受预览帧；释放或源失败后拒绝后续输入。
   */
  get isRequestingFrames(): boolean {
    return this.active;
  }

  /**
   * 同步克隆视频，提交方可在返回后释放原帧；时间戳不合法时忽略。
   */
  pushVideo(frame: VideoFrame): void {
    if (!this.active || !Number.isSafeInteger(frame.timestamp) || frame.timestamp < 0 || frame.timestamp <= this.lastVideoTime) {
      return;
    }
    try {
      if (frame.displayWidth !== this.sourceFormat.width || frame.displayHeight !== this.sourceFormat.height) {
        throw new XmaxError(XmaxErrorCode.mediaError, "External video frame dimensions must match source.videoFormat");
      }
      const time = this.mapTime(frame.timestamp);
      const copy = frame.clone();
      this.lastVideoTime = frame.timestamp;
      if (this.pending) {
        this.next?.frame.close();
        this.next = { frame: copy, time };
      } else {
        this.scheduleVideo(copy, time);
      }
    } catch (error) {
      this.reportError(XmaxError.from(error));
    }
  }

  /**
   * 到时呈现当前帧，再安排最新后续帧；最多持有两个副本。
   */
  private scheduleVideo(copy: VideoFrame, time: number): void {
    this.pending = copy;
    this.timer = setTimeout(() => {
      this.pending = undefined;
      this.timer = undefined;
      try {
        if (this.active) {
          this.context.drawImage(copy, 0, 0, this.videoFormat.width, this.videoFormat.height);
          this.track.requestFrame?.();
        }
      } catch (error) {
        this.reportError(XmaxError.from(error));
      } finally {
        copy.close();
      }

      const next = this.next;
      this.next = undefined;
      if (this.active && next) {
        this.scheduleVideo(next.frame, next.time);
      }
    }, Math.max(0, (time - this.nowUs()) / 1000));
  }

  /**
   * 复制音频并使用与视频相同的时间映射；未声明音频时忽略。
   */
  pushAudio(frame: RealtimeExternalAudioFrame): void {
    if (!this.active || !this.audio) {
      return;
    }
    try {
      this.audio.push(frame, timestamp => this.mapTime(timestamp));
    } catch (error) {
      this.reportError(XmaxError.from(error));
    }
  }

  /**
   * 首次失败立即使 sink 失效，再通知上层释放连接和本地媒体。
   */
  reportError(error: Error): void {
    if (!this.active) {
      return;
    }
    this.invalidate();
    this.onError(new XmaxError(XmaxErrorCode.mediaError, `External source failed: ${error.message}`));
  }

  /**
   * 释放未呈现副本并停止音频排队，不接管原帧或接入方设备。
   */
  invalidate(): void {
    this.active = false;
    this.clearVideo();
    this.audio?.setPublished(false);
  }

  /**
   * 清理当前等待呈现的副本。
   */
  private clearVideo(): void {
    clearTimeout(this.timer);
    this.timer = undefined;
    this.pending?.close();
    this.pending = undefined;
    this.next?.frame.close();
    this.next = undefined;
  }

  /**
   * 有音频时以采样时钟为基准，纯视频使用浏览器单调时钟。
   */
  private nowUs(): number {
    return this.audio?.nowUs ?? performance.now() * 1000;
  }

  /**
   * 共用 20ms 调度余量；源暂停或线程长时间阻塞后重新锚定两轨，不重放旧队列。
   */
  private mapTime(timestamp: number): number {
    const now = this.nowUs();
    let time = this.anchor ? this.anchor.output + timestamp - this.anchor.source : now + 20_000;
    if (!this.anchor || time < now - 250_000) {
      this.clearVideo();
      this.audio?.reset();
      this.anchor = { source: timestamp, output: now + 20_000 };
      time = this.anchor.output;
    }
    if (time > now + 2_000_000) {
      throw new XmaxError(XmaxErrorCode.mediaError, "External frames must use a shared monotonic timeline and be paced in real time");
    }
    return time;
  }
}
