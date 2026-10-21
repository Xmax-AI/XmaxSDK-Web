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
 * 将摄像头原始帧旋转为固定目标尺寸，供预览和 RTC 共用。
 * 只持有输入轨引用，不关闭摄像头；拥有输出轨和帧调度资源。
 */
export class CameraRotationProcessor {

  /**
   * 用于读取或预览源画面的视频元素。
   */
  private readonly video = document.createElement("video");

  /**
   * 承载媒体帧的画布。
   */
  private readonly canvas = document.createElement("canvas");

  /**
   * 画布绘制上下文。
   */
  private readonly context: CanvasRenderingContext2D;

  /**
   * 由当前媒体源输出的浏览器媒体流。
   */
  private stream?: MediaStream;

  /**
   * 旋转处理前的摄像头原始轨，不由本组件关闭。
   */
  private source?: MediaStreamTrack;

  /**
   * 等待下一帧的视频回调句柄。
   */
  private frameCallback?: number;

  /**
   * 当前等待或定时任务的取消句柄。
   */
  private timer?: ReturnType<typeof setTimeout>;

  /**
   * 终止尚未完成的首帧等待。
   */
  private cancelPending?: () => void;

  /**
   * 是否已停止调度并释放当前管线。
   */
  private stopped = false;

  /**
   * 标识当前媒体操作，过滤旧操作的迟到结果。
   */
  private version = 0;

  /**
   * 摄像头原始轨结束时停止旋转处理。
   */
  private readonly sourceEnded = () => {
    this.fail(new XmaxError(XmaxErrorCode.mediaError, "Camera source ended during rotation"));
  };

  /**
   * 准备旋转画布与播放器，浏览器不支持画布采集时抛出错误。
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
    const context = this.canvas.getContext("2d", { alpha: false });
    if (!context || typeof this.canvas.captureStream !== "function") {
      throw new XmaxError(XmaxErrorCode.mediaError, "Canvas camera rotation is not supported by this browser");
    }
    this.context = context;
    this.video.muted = true;
    this.video.autoplay = true;
    this.video.playsInline = true;
  }

  /**
   * 等待第一帧实际绘制成功；换摄像头时复用输出轨，不重建 sender。
   */
  async setSource(
    source: MediaStreamTrack
  ): Promise<MediaStreamTrack> {
    if (this.stopped)
      throw new XmaxError(XmaxErrorCode.cancelled, "Camera rotation has stopped");
    if (source.readyState === "ended") {
      this.stop();
      throw new XmaxError(XmaxErrorCode.mediaError, "Camera rotation requires a live source");
    }
    this.cancelPending?.();
    this.cancelFrame();
    this.source?.removeEventListener("ended", this.sourceEnded);
    const version = ++this.version;
    this.source = source;
    source.addEventListener("ended", this.sourceEnded);
    this.video.srcObject = new MediaStream([source]);

    try {
      await new Promise<void>((resolve, reject) => {
        let settled = false;
        const finish = (error?: unknown) => {
          if (settled)
            return;
          settled = true;
          clearTimeout(timeout);
          this.cancelPending = undefined;
          if (error)
            reject(error);
          else
            resolve();
        };
        const timeout = setTimeout(() => finish(new XmaxError(XmaxErrorCode.timeout, "Timed out waiting for a camera rotation frame")), 10000);
        this.cancelPending = () => finish(new XmaxError(XmaxErrorCode.cancelled, "Camera rotation source changed"));
        // play() 的异步完成也可能晚于停止/切换，不能复活旧的绘制循环。
        void this.video.play().then(() => {
          if (settled || this.stopped || version !== this.version)
            return;
          const firstFrame = () => {
            if (settled || this.stopped || version !== this.version)
              return;
            try {
              if (!this.draw()) {
                this.schedule(firstFrame);
                return;
              }
              this.stream ??= this.canvas.captureStream(this.options.frameRate);
              if (!this.stream.getVideoTracks()[0])
                throw new Error("Canvas did not produce a video track");
              this.requestFrame();
              finish();
              this.schedule(() => this.render(version));
            } catch (error) {
              finish(error);
            }
          };
          this.schedule(firstFrame);
        }, finish);
      });
      if (this.stopped || version !== this.version) {
        throw new XmaxError(XmaxErrorCode.cancelled, "Camera rotation source changed");
      }
      return this.stream!.getVideoTracks()[0]!;
    } catch (error) {
      if (version === this.version)
        this.stop();
      throw XmaxError.from(error);
    }
  }

  /**
   * 换设备前解除旧原始轨监听，保留 Canvas 最后一帧及输出轨。
   */
  pauseSource(): void {
    ++this.version;
    this.cancelPending?.();
    this.cancelFrame();
    this.source?.removeEventListener("ended", this.sourceEnded);
    this.source = undefined;
    this.video.pause();
    this.video.srcObject = null;
  }

  /**
   * 停止旋转调度并释放输出轨，保留原始摄像头轨的所有权。
   */
  stop(): void {
    if (this.stopped)
      return;
    this.stopped = true;
    ++this.version;
    this.cancelPending?.();
    this.cancelFrame();
    this.source?.removeEventListener("ended", this.sourceEnded);
    this.source = undefined;
    this.video.pause();
    this.video.srcObject = null;
    this.stream?.getTracks().forEach(track => track.stop());
    this.stream = undefined;
    this.canvas.width = this.canvas.height = 0;
  }

  /**
   * 按旋转后的目标尺寸居中裁剪并绘制当前源帧。
   */
  private draw(): boolean {
    const { videoWidth: width, videoHeight: height } = this.video;
    if (this.video.readyState < 2 || !width || !height)
      return false;
    const { width: outWidth, height: outHeight, rotation } = this.options;
    const quarterTurn = rotation === 90 || rotation === 270;
    const targetWidth = quarterTurn ? outHeight : outWidth;
    const targetHeight = quarterTurn ? outWidth : outHeight;
    // 设备不一定满足请求宽高；按真实帧尺寸等比居中裁剪，绝不拉伸。
    const scale = Math.max(targetWidth / width, targetHeight / height);
    const cropWidth = targetWidth / scale, cropHeight = targetHeight / scale;
    this.context.setTransform(1, 0, 0, 1, outWidth / 2, outHeight / 2);
    this.context.rotate(rotation * Math.PI / 180);
    this.context.drawImage(this.video, (width - cropWidth) / 2, (height - cropHeight) / 2,
      cropWidth, cropHeight, -targetWidth / 2, -targetHeight / 2, targetWidth, targetHeight);
    return true;
  }

  /**
   * 绘制当前源帧并继续调度；媒体源已切换或停止时结束调度。
   */
  private render(
    version: number
  ): void {
    if (this.stopped || version !== this.version)
      return;
    try {
      if (this.draw())
        this.requestFrame();
      this.schedule(() => this.render(version));
    } catch (error) {
      this.fail(XmaxError.from(error));
    }
  }

  /**
   * 通知画布输出轨发送刚绘制的帧。
   */
  private requestFrame(): void {
    const track = this.stream?.getVideoTracks()[0] as CanvasCaptureMediaStreamTrack | undefined;
    track?.requestFrame?.();
  }

  /**
   * 优先等待原生视频帧回调，不支持时按目标帧率定时绘制。
   */
  private schedule(
    callback: () => void
  ): void {
    if (typeof this.video.requestVideoFrameCallback === "function") {
      this.frameCallback = this.video.requestVideoFrameCallback(callback);
    } else {
      this.timer = setTimeout(callback, 1000 / this.options.frameRate);
    }
  }

  /**
   * 取消下一次视频帧回调和定时绘制任务。
   */
  private cancelFrame(): void {
    if (this.frameCallback !== undefined)
      this.video.cancelVideoFrameCallback(this.frameCallback);
    clearTimeout(this.timer);
    this.frameCallback = undefined;
    this.timer = undefined;
  }

  /**
   * 释放旋转资源并向上层报告媒体错误。
   */
  private fail(
    error: XmaxError
  ): void {
    this.stop();
    this.options.onError(error);
  }
}
