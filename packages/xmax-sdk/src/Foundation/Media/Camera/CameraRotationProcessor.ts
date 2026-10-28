//
//  CameraRotationProcessor.ts
//  XmaxSDK
//
//  Author: 翁跃庭 (Yueting Weng)
//  GitHub: https://github.com/Xmax-AI/XmaxSDK-Web
//
//  Copyright (c) 2026 XMAX.AI PTE. LTD.
//

import { XmaxError, XmaxErrorCode } from "../../Errors/XmaxError";
import type { CameraRotation } from "./CameraRotation";

/**
 * Rotates camera frames to fixed output dimensions shared by preview and RTC. Borrows the camera track
 * and owns the output track and scheduling resources.
 */
export class CameraRotationProcessor {

  /**
   * The video element reading source frames.
   */
  private readonly video = document.createElement("video");

  /**
   * The canvas holding rotated output frames.
   */
  private readonly canvas = document.createElement("canvas");

  /**
   * The canvas drawing context.
   */
  private readonly context: CanvasRenderingContext2D;

  /**
   * The browser stream produced by this processor.
   */
  private stream?: MediaStream;

  /**
   * The borrowed camera track before rotation.
   */
  private source?: MediaStreamTrack;

  /**
   * The pending video-frame callback handle.
   */
  private frameCallback?: number;

  /**
   * The pending fallback timer.
   */
  private timer?: ReturnType<typeof setTimeout>;

  /**
   * The callback cancelling an unfinished first-frame wait.
   */
  private cancelPending?: () => void;

  /**
   * Whether scheduling has stopped and the pipeline is released.
   */
  private stopped = false;

  /**
   * The source-operation revision rejecting obsolete asynchronous results.
   */
  private version = 0;

  /**
   * The handler failing rotation when the borrowed camera track ends.
   */
  private readonly sourceEnded = () => {
    this.fail(new XmaxError(
      XmaxErrorCode.mediaError,
      "Camera source ended during rotation"
    ));
  };

  /**
   * Creates the rotation canvas and player, rejecting browsers without Canvas capture.
   */
  constructor(
    private readonly options: {
      width: number;
      height: number;
      frameRate: number;
      rotation: Exclude<CameraRotation, 0>;
      onError: (
        error: XmaxError
      ) => void;
    }
  ) {
    this.canvas.width = options.width;
    this.canvas.height = options.height;
    const context = this.canvas.getContext(
      "2d",
      { alpha: false }
    );
    if (!context || typeof this.canvas.captureStream !== "function") {
      throw new XmaxError(
        XmaxErrorCode.mediaError,
        "Canvas camera rotation is not supported by this browser"
      );
    }
    this.context = context;
    this.video.muted = true;
    this.video.autoplay = true;
    this.video.playsInline = true;
  }

  /**
   * Waits for a successfully drawn first frame, reusing the output track across camera switches.
   */
  async setSource(
    source: MediaStreamTrack
  ): Promise<MediaStreamTrack> {
    if (this.stopped) {
      throw new XmaxError(
        XmaxErrorCode.cancelled,
        "Camera rotation has stopped"
      );
    }
    if (source.readyState === "ended") {
      this.stop();
      throw new XmaxError(
        XmaxErrorCode.mediaError,
        "Camera rotation requires a live source"
      );
    }
    this.cancelPending?.();
    this.cancelFrame();
    this.source?.removeEventListener(
      "ended",
      this.sourceEnded
    );
    const version = ++this.version;
    this.source = source;
    source.addEventListener(
      "ended",
      this.sourceEnded
    );
    this.video.srcObject = new MediaStream([source]);

    try {
      await new Promise<void>((
        resolve,
        reject
      ) => {
        let settled = false;
        const finish = (error?: unknown) => {
          if (settled) {
            return;
          }
          settled = true;
          clearTimeout(timeout);
          this.cancelPending = undefined;
          if (error) {
            reject(error);
          }
          else {
            resolve();
          }
        };
        const timeout = setTimeout(
          () => finish(new XmaxError(
            XmaxErrorCode.timeout,
            "Timed out waiting for a camera rotation frame"
          )),
          10000
        );
        this.cancelPending = () => finish(new XmaxError(
          XmaxErrorCode.cancelled,
          "Camera rotation source changed"
        ));
        // Late play() completion must not revive rendering after a stop or source change.
        void this.video.play().then(
          () => {
            if (settled || this.stopped || version !== this.version) {
              return;
            }
            const firstFrame = () => {
              if (settled || this.stopped || version !== this.version) {
                return;
              }
              try {
                if (!this.draw()) {
                  this.schedule(firstFrame);
                  return;
                }
                this.stream ??= this.canvas.captureStream(this.options.frameRate);
                if (!this.stream.getVideoTracks()[0]) {
                  throw new Error("Canvas did not produce a video track");
                }
                this.requestFrame();
                finish();
                this.schedule(() => this.render(version));
              } catch (error) {
                finish(error);
              }
            };
            this.schedule(firstFrame);
          },
          finish
        );
      });
      if (this.stopped || version !== this.version) {
        throw new XmaxError(
          XmaxErrorCode.cancelled,
          "Camera rotation source changed"
        );
      }
      return this.stream!.getVideoTracks()[0]!;
    } catch (error) {
      if (version === this.version) {
        this.stop();
      }
      throw XmaxError.from(error);
    }
  }

  /**
   * Unbinds the old source before a device change while retaining the last canvas frame and output
   * track.
   */
  pauseSource(): void {
    ++this.version;
    this.cancelPending?.();
    this.cancelFrame();
    this.source?.removeEventListener(
      "ended",
      this.sourceEnded
    );
    this.source = undefined;
    this.video.pause();
    this.video.srcObject = null;
  }

  /**
   * Updates rotated dimensions and output frame rate without replacing the output track or source
   * scheduler.
   */
  async updateFormat(
    width: number,
    height: number,
    frameRate: number
  ): Promise<void> {
    if (this.stopped) {
      throw new XmaxError(
        XmaxErrorCode.cancelled,
        "Camera rotation has stopped"
      );
    }
    const version = this.version;
    const output = this.stream?.getVideoTracks()[0];
    await output?.applyConstraints({ frameRate });
    if (this.stopped || this.version !== version) {
      throw new XmaxError(
        XmaxErrorCode.cancelled,
        "Camera rotation source changed"
      );
    }
    Object.assign(
      this.options,
      {
        width,
        height,
        frameRate
      }
    );
    this.canvas.width = width;
    this.canvas.height = height;
    if (this.draw()) {
      this.requestFrame();
    }
  }

  /**
   * Stops scheduling and releases output resources without stopping the borrowed camera track.
   */
  stop(): void {
    if (this.stopped) {
      return;
    }
    this.stopped = true;
    ++this.version;
    this.cancelPending?.();
    this.cancelFrame();
    this.source?.removeEventListener(
      "ended",
      this.sourceEnded
    );
    this.source = undefined;
    this.video.pause();
    this.video.srcObject = null;
    this.stream?.getTracks().forEach(track => track.stop());
    this.stream = undefined;
    this.canvas.width = this.canvas.height = 0;
  }

  /**
   * Draws the source using a centered crop at the post-rotation target dimensions.
   */
  private draw(): boolean {
    const { videoWidth: width, videoHeight: height } = this.video;
    if (this.video.readyState < 2 || !width || !height) {
      return false;
    }
    const { width: outWidth, height: outHeight, rotation } = this.options;
    const quarterTurn = rotation === 90 || rotation === 270;
    const targetWidth = quarterTurn ? outHeight : outWidth;
    const targetHeight = quarterTurn ? outWidth : outHeight;
    // Use actual frame dimensions for proportional cropping; capture constraints may not be satisfied exactly.
    const scale = Math.max(targetWidth / width, targetHeight / height);
    const cropWidth = targetWidth / scale, cropHeight = targetHeight / scale;
    this.context.setTransform(
      1,
      0,
      0,
      1,
      outWidth / 2,
      outHeight / 2
    );
    this.context.rotate(rotation * Math.PI / 180);
    this.context.drawImage(
      this.video,
      (width - cropWidth) / 2,
      (height - cropHeight) / 2,
      cropWidth,
      cropHeight,
      -targetWidth / 2,
      -targetHeight / 2,
      targetWidth,
      targetHeight
    );
    return true;
  }

  /**
   * Draws and reschedules the current source, stopping when its revision is obsolete.
   */
  private render(
    version: number
  ): void {
    if (this.stopped || version !== this.version) {
      return;
    }
    try {
      if (this.draw()) {
        this.requestFrame();
      }
      this.schedule(() => this.render(version));
    } catch (error) {
      this.fail(XmaxError.from(error));
    }
  }

  /**
   * Requests publication of the newly drawn canvas frame.
   */
  private requestFrame(): void {
    const track = this.stream?.getVideoTracks()[0] as CanvasCaptureMediaStreamTrack | undefined;
    track?.requestFrame?.();
  }

  /**
   * Schedules a native video-frame callback, falling back to a timer at the target frame rate.
   */
  private schedule(
    callback: () => void
  ): void {
    if (typeof this.video.requestVideoFrameCallback === "function") {
      this.frameCallback = this.video.requestVideoFrameCallback(callback);
    } else {
      this.timer = setTimeout(
        callback,
        1000 / this.options.frameRate
      );
    }
  }

  /**
   * Cancels the pending frame callback and fallback timer.
   */
  private cancelFrame(): void {
    if (this.frameCallback !== undefined) {
      this.video.cancelVideoFrameCallback(this.frameCallback);
    }
    clearTimeout(this.timer);
    this.frameCallback = undefined;
    this.timer = undefined;
  }

  /**
   * Releases rotation resources and reports a media failure.
   */
  private fail(
    error: XmaxError
  ): void {
    this.stop();
    this.options.onError(error);
  }
}
