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
 * Validates source timestamps and schedules frames on a shared clock; unbinding permanently invalidates
 * this sink.
 */
export class ExternalFrameSink implements RealtimeExternalFrameSink {

  /**
   * Whether the binding still accepts input.
   */
  private active = true;

  /**
   * The last accepted video timestamp, in source microseconds.
   */
  private lastVideoTime = -1;

  /**
   * The source and output clock origins, both in microseconds.
   */
  private anchor?: {
    source: number;
    output: number
  };

  /**
   * The next scheduled frame; a newer frame must not repeatedly postpone its presentation.
   */
  private pending?: VideoFrame;

  /**
   * The latest successor frame and its scheduled output timestamp, in microseconds.
   */
  private next?: {
    frame: VideoFrame;
    time: number
  };

  /**
   * The timer presenting the pending video frame.
   */
  private timer?: ReturnType<typeof setTimeout>;

  /**
   * Creates a sink with fixed formats, Canvas output, optional audio, and a terminal failure callback.
   */
  constructor(
    readonly videoFormat: RealtimeVideoFormat,
    private readonly sourceFormat: RealtimeVideoFormat,
    private readonly context: CanvasRenderingContext2D,
    private readonly track: CanvasCaptureMediaStreamTrack,
    private readonly audio: ExternalAudioFrameSource | undefined,
    private readonly onError: (
      error: XmaxError
    ) => void,
  ) { }

  /**
   * Whether frames are accepted, including disconnected preview; false after release or failure.
   */
  get isRequestingFrames(): boolean {
    return this.active;
  }

  /**
   * Clones video synchronously so the caller may close the original afterward; invalid timestamps are
   * ignored.
   */
  pushVideo(
    frame: VideoFrame
  ): void {
    if (!this.active || !Number.isSafeInteger(frame.timestamp) || frame.timestamp < 0 || frame.timestamp <= this.lastVideoTime) {
      return;
    }
    try {
      if (frame.displayWidth !== this.sourceFormat.width || frame.displayHeight !== this.sourceFormat.height) {
        throw new XmaxError(
          XmaxErrorCode.mediaError,
          "External video frame dimensions must match source.videoFormat"
        );
      }
      const time = this.mapTime(frame.timestamp);
      const copy = frame.clone();
      this.lastVideoTime = frame.timestamp;
      if (this.pending) {
        this.next?.frame.close();
        this.next = {
          frame: copy,
          time
        };
      } else {
        this.scheduleVideo(
          copy,
          time
        );
      }
    } catch (error) {
      this.reportError(XmaxError.from(error));
    }
  }

  /**
   * Presents the scheduled frame and then the latest successor, retaining at most two copies.
   */
  private scheduleVideo(
    copy: VideoFrame,
    time: number
  ): void {
    this.pending = copy;
    this.timer = setTimeout(
      () => {
        this.pending = undefined;
        this.timer = undefined;
        try {
          if (this.active) {
            this.context.drawImage(
              copy,
              0,
              0,
              this.videoFormat.width,
              this.videoFormat.height
            );
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
          this.scheduleVideo(
            next.frame,
            next.time
          );
        }
      },
      Math.max(0, (time - this.nowUs()) / 1000)
    );
  }

  /**
   * Copies audio using the shared video time mapping, ignoring audio when the source did not declare it.
   */
  pushAudio(
    frame: RealtimeExternalAudioFrame
  ): void {
    if (!this.active || !this.audio) {
      return;
    }
    try {
      this.audio.push(
        frame,
        timestamp => this.mapTime(timestamp)
      );
    } catch (error) {
      this.reportError(XmaxError.from(error));
    }
  }

  /**
   * Invalidates input on the first failure before notifying lifecycle cleanup.
   */
  reportError(
    error: Error
  ): void {
    if (!this.active) {
      return;
    }
    this.invalidate();
    this.onError(new XmaxError(
      XmaxErrorCode.mediaError,
      `External source failed: ${error.message}`
    ));
  }

  /**
   * Releases queued copies and audio without owning input frames or app capture devices.
   */
  invalidate(): void {
    this.active = false;
    this.clearVideo();
    this.audio?.setPublished(false);
  }

  /**
   * Releases pending video-frame copies.
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
   * Returns the audio sampling clock when available, otherwise the browser monotonic clock, in
   * microseconds.
   */
  private nowUs(): number {
    return this.audio?.nowUs ?? performance.now() * 1000;
  }

  /**
   * Maps both tracks with a shared 20 ms scheduling allowance, reanchoring after pauses or long stalls
   * without replaying old queues.
   */
  private mapTime(
    timestamp: number
  ): number {
    const now = this.nowUs();
    let time = this.anchor ? this.anchor.output + timestamp - this.anchor.source : now + 20_000;
    if (!this.anchor || time < now - 250_000) {
      this.clearVideo();
      this.audio?.reset();
      this.anchor = {
        source: timestamp,
        output: now + 20_000
      };
      time = this.anchor.output;
    }
    if (time > now + 2_000_000) {
      throw new XmaxError(
        XmaxErrorCode.mediaError,
        "External frames must use a shared monotonic timeline and be paced in real time"
      );
    }
    return time;
  }
}
