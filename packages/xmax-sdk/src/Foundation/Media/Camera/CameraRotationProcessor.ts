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
import { cameraFrameGeometryByTrack, type CameraFrameGeometry } from "./CameraFrameGeometry";
import type { CameraRotation } from "./CameraRotation";

/**
 * Crops, rotates, and mirrors camera frames in one draw. Borrows the camera track and owns the output
 * track and scheduling resources.
 */
export class CameraRotationProcessor {

  /**
   * The video element reading source frames.
   */
  private readonly video = document.createElement("video");

  /**
   * The canvas holding the processed camera frames.
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
   * The borrowed camera track before processing.
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
   * The handler failing processing when the borrowed camera track ends.
   */
  private readonly sourceEnded = () => {
    this.fail(new XmaxError(
      XmaxErrorCode.mediaError,
      "Camera source ended during processing"
    ));
  };

  /**
   * Creates the output canvas and source player.
   */
  constructor(
    private readonly options: {
      width: number;
      height: number;
      frameRate: number;
      rotation: CameraRotation;
      mirrored?: boolean;
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
        "Canvas camera processing is not supported by this browser"
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
    source: MediaStreamTrack,
    prepareSource?: (video: HTMLVideoElement) => Promise<void> | undefined
  ): Promise<MediaStreamTrack> {
    if (this.stopped) {
      throw new XmaxError(
        XmaxErrorCode.cancelled,
        "Camera processing has stopped"
      );
    }
    if (source.readyState === "ended") {
      this.stop();
      throw new XmaxError(
        XmaxErrorCode.mediaError,
        "Camera processing requires a live source"
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
            "Timed out waiting for a processed camera frame"
          )),
          10000
        );
        this.cancelPending = () => finish(new XmaxError(
          XmaxErrorCode.cancelled,
          "Camera processing source changed"
        ));
        // Late play() completion must not revive rendering after a stop or source change.
        void this.video.play().then(
          () => {
            if (settled || this.stopped || version !== this.version) {
              return;
            }
            const firstFrame = async () => {
              if (settled || this.stopped || version !== this.version) {
                return;
              }
              try {
                if (prepareSource && this.video.readyState >= 2 && this.video.videoWidth && this.video.videoHeight) {
                  const prepare = prepareSource;
                  prepareSource = undefined;
                  const preparation = prepare(this.video);
                  if (preparation) {
                    await preparation;
                    if (settled || this.stopped || version !== this.version) {
                      return;
                    }
                  }
                }
                let geometry: CameraFrameGeometry | undefined;
                if (!this.draw(value => { geometry = value; })) {
                  this.schedule(firstFrame);
                  return;
                }
                this.stream ??= this.canvas.captureStream(this.options.frameRate);
                const track = this.stream.getVideoTracks()[0];
                if (!track) {
                  throw new Error("Canvas did not produce a video track");
                }
                if (geometry) {
                  cameraFrameGeometryByTrack.set(track, geometry);
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
          "Camera processing source changed"
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
   * Updates dimensions and output frame rate without replacing the output track or source
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
        "Camera processing has stopped"
      );
    }
    const version = this.version;
    const output = this.stream?.getVideoTracks()[0];
    await output?.applyConstraints({ frameRate });
    if (this.stopped || this.version !== version) {
      throw new XmaxError(
        XmaxErrorCode.cancelled,
        "Camera processing source changed"
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
   * Draws a centered crop with rotation and horizontal mirroring in the output orientation.
   * Reports the geometry on the first successful draw for each camera source.
   */
  private draw(onGeometry?: (geometry: CameraFrameGeometry) => void): boolean {
    const { videoWidth: width, videoHeight: height } = this.video;
    if (this.video.readyState < 2 || !width || !height) {
      return false;
    }
    const { width: outWidth, height: outHeight, rotation, mirrored } = this.options;
    const quarterTurn = rotation === 90 || rotation === 270;
    const targetWidth = quarterTurn ? outHeight : outWidth;
    const targetHeight = quarterTurn ? outWidth : outHeight;
    // Use actual frame dimensions for proportional cropping; capture constraints may not be satisfied exactly.
    const scale = Math.max(targetWidth / width, targetHeight / height);
    const cropWidth = targetWidth / scale, cropHeight = targetHeight / scale;

    this.context.setTransform(
      mirrored ? -1 : 1,
      0,
      0,
      1,
      outWidth / 2,
      outHeight / 2
    );
    if (rotation !== 0) {
      this.context.rotate(rotation * Math.PI / 180);
    }
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

    if (onGeometry) {
      const constraints = this.source?.getConstraints?.();
      const requestedWidth = typeof constraints?.width === "number" ? constraints.width : constraints?.width?.ideal;
      const requestedHeight = typeof constraints?.height === "number" ? constraints.height : constraints?.height?.ideal;
      const crop = { width: Math.round(cropWidth), height: Math.round(cropHeight) };
      onGeometry({
        requested: requestedWidth && requestedHeight ? { width: requestedWidth, height: requestedHeight } : undefined,
        source: { width, height },
        crop,
        output: { width: outWidth, height: outHeight },
      });
    }

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
   * Releases processing resources and reports a media failure.
   */
  private fail(
    error: XmaxError
  ): void {
    this.stop();
    this.options.onError(error);
  }
}
