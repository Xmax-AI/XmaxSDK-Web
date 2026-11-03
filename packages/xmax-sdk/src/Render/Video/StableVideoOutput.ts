//
//  StableVideoOutput.ts
//  XmaxSDK
//
//  Author: 翁跃庭 (Yueting Weng)
//  GitHub: https://github.com/Xmax-AI/XmaxSDK-Web
//
//  Copyright (c) 2026 XMAX.AI PTE. LTD.
//

import { XmaxError, XmaxErrorCode } from "../../Foundation/Errors/XmaxError";

/**
 * Copies selected result pixels into one browser track. Switching beauty input never changes that
 * track's identity; natural dimensions may follow RTC quality changes. No audio or overlays are drawn.
 */
export class StableVideoOutput {

  /**
   * The hidden decoder for the currently selected input.
   */
  private readonly video: HTMLVideoElement;

  /**
   * The shared unmirrored result surface.
   */
  private readonly canvas: HTMLCanvasElement;

  /**
   * The drawing context retained until output is released.
   */
  private readonly context: CanvasRenderingContext2D;

  /**
   * The owned canvas stream, created after a valid frame.
   */
  private stream?: MediaStream;

  /**
   * The pending browser frame callback.
   */
  private frameCallback?: number;

  /**
   * The animation-frame fallback for browsers without video frame callbacks.
   */
  private animationFrame?: number;

  /**
   * The revision rejecting callbacks from a replaced input.
   */
  private revision = 0;

  /**
   * Whether output has been released.
   */
  private disposed = false;

  /**
   * Bounds the initial result-frame wait without running a permanent timer.
   */
  private timer?: ReturnType<typeof setTimeout>;

  /**
   * Creates a browser output surface without loading beauty dependencies.
   */
  constructor(
    private readonly onOutput: (
      track: MediaStreamTrack
    ) => void,
    private readonly onError: (
      error: unknown
    ) => void,
  ) {
    if (typeof document === "undefined") {
      throw new XmaxError(
        XmaxErrorCode.mediaError,
        "Result beauty requires browser video and canvas support"
      );
    }
    this.canvas = document.createElement("canvas");
    const context = this.canvas.getContext?.(
      "2d",
      { alpha: false }
    );
    if (!context || typeof this.canvas.captureStream !== "function") {
      throw new XmaxError(
        XmaxErrorCode.mediaError,
        "Result beauty requires canvas capture support"
      );
    }
    this.context = context;
    this.video = document.createElement("video");
    this.video.muted = true;
    this.video.playsInline = true;
    Object.assign(
      this.video.style,
      {
        position: "fixed",
        top: "0",
        left: "0",
        width: "1px",
        height: "1px",
        opacity: "0",
        pointerEvents: "none",
      }
    );
    this.video.setAttribute(
      "aria-hidden",
      "true"
    );
    document.body.appendChild(this.video);
    this.timer = setTimeout(
      () => this.onError(new XmaxError(
        XmaxErrorCode.timeout,
        "Shared result video did not produce a frame"
      )),
      5000
    );
  }

  /**
   * Changes borrowed input without replacing the owned output track.
   */
  setSource(
    track: MediaStreamTrack
  ): void {
    if (this.disposed) {
      return;
    }
    this.cancelFrame();
    const revision = ++this.revision;
    const video = this.video;
    video.srcObject = new MediaStream([track]);
    let previousTime = -1;
    const current = () => !this.disposed && this.revision === revision;
    const fail = (error: unknown) => {
      if (current()) {
        this.cancelFrame();
        this.onError(error);
      }
    };
    video.onerror = () => fail(new XmaxError(
      XmaxErrorCode.mediaError,
      "Result video playback failed"
    ));
    const tick = () => {
      if (!current()) {
        return;
      }
      try {
        if (video.readyState >= 2 && video.videoWidth > 0 && video.videoHeight > 0 && video.currentTime !== previousTime) {
          if (this.canvas.width !== video.videoWidth || this.canvas.height !== video.videoHeight) {
            this.canvas.width = video.videoWidth;
            this.canvas.height = video.videoHeight;
          }
          this.context.drawImage(
            video,
            0,
            0
          );
          previousTime = video.currentTime;
          if (!this.stream) {
            this.stream = this.canvas.captureStream(0);
            if (typeof (this.stream.getVideoTracks()[0] as CanvasCaptureMediaStreamTrack | undefined)?.requestFrame !== "function") {
              this.stream.getTracks().forEach(item => item.stop());
              this.stream = this.canvas.captureStream(60);
            }
            const output = this.stream.getVideoTracks()[0];
            if (!output) {
              throw new XmaxError(
                XmaxErrorCode.mediaError,
                "Canvas did not produce a result video track"
              );
            }
            clearTimeout(this.timer);
            this.onOutput(output);
          }
          (this.stream.getVideoTracks()[0] as CanvasCaptureMediaStreamTrack).requestFrame?.();
        }
        if (!current()) {
          return;
        }
        if (typeof video.requestVideoFrameCallback === "function") {
          this.frameCallback = video.requestVideoFrameCallback(tick);
        } else {
          this.animationFrame = requestAnimationFrame(tick);
        }
      } catch (error) {
        fail(error);
      }
    };
    void video.play().then(
      tick,
      fail
    );
  }

  /**
   * Cancels only callbacks owned by this output.
   */
  private cancelFrame(): void {
    if (this.frameCallback !== undefined) {
      this.video.cancelVideoFrameCallback(this.frameCallback);
      this.frameCallback = undefined;
    }
    if (this.animationFrame !== undefined) {
      cancelAnimationFrame(this.animationFrame);
      this.animationFrame = undefined;
    }
  }

  /**
   * Releases canvas output and playback without stopping borrowed input tracks.
   */
  dispose(): void {
    if (this.disposed) {
      return;
    }
    this.disposed = true;
    clearTimeout(this.timer);
    this.revision++;
    this.cancelFrame();
    this.video.onerror = null;
    this.video.pause();
    this.video.srcObject = null;
    this.video.remove();
    this.stream?.getTracks().forEach(track => track.stop());
    this.canvas.width = this.canvas.height = 0;
  }
}
