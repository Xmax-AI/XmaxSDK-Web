//
//  RemoteVideoFrameSource.ts
//  XmaxSDK
//
//  Author: 翁跃庭 (Yueting Weng)
//  GitHub: https://github.com/Xmax-AI/XmaxSDK-Web
//
//  Copyright (c) 2026 XMAX.AI PTE. LTD.
//

import { XmaxError, XmaxErrorCode } from "../../Errors/XmaxError";

/**
 * 原始解码视频帧及其时间连续性，不包含客户端插帧。
 */
export interface RemoteVideoPacket {

  /**
   * 拷贝出的帧，所有权交给调用方。
   */
  frame: VideoFrame;

  /**
   * 帧回调或时钟存在跳变。
   */
  discontinuous: boolean;
}

/**
 * 通过独立的静音 video 观察原始轨道，不依赖 SDK 视图或插帧画布。
 * 帧按浏览器呈现回调获取，不保证包含全部网络接收/解码帧。
 */
export class RemoteVideoFrameSource {

  /**
   * 媒体元素和回调资源
   */
  private video?: HTMLVideoElement;

  /**
   * 当前视频帧观察句柄。
   */
  private callback?: number;

  /**
   * 借用轨道及其结束通知。
   */
  private track?: MediaStreamTrack;

  /**
   * 当前视频轨结束后取消观察。
   */
  private onEnded?: () => void;

  /**
   * 开始观察原始视频；失败交给上层隔离处理，不影响主播放器。
   */
  start(track: MediaStreamTrack, listener: (packet: RemoteVideoPacket) => void, onError: (error: unknown) => void): void {
    this.stop();
    if (typeof VideoFrame === "undefined" || typeof HTMLVideoElement === "undefined" ||
      typeof HTMLVideoElement.prototype.requestVideoFrameCallback !== "function") {
      throw new XmaxError(XmaxErrorCode.mediaError, "Remote video frames require VideoFrame and requestVideoFrameCallback");
    }
    const video = document.createElement("video");
    this.video = video;
    this.track = track;
    this.onEnded = () => this.stop();
    track.addEventListener("ended", this.onEnded, { once: true });
    video.muted = true;
    video.playsInline = true;
    video.autoplay = true;
    video.srcObject = new MediaStream([track]);
    Object.assign(video.style, { position: "fixed", top: "0", left: "0", width: "1px", height: "1px", opacity: "0", pointerEvents: "none" });
    video.setAttribute("aria-hidden", "true");
    document.body.appendChild(video);
    let previousPTS: number | undefined;
    let previousMediaTime: number | undefined;
    let previousFrames: number | undefined;
    let previousSize: string | undefined;
    const next = () => {
      this.callback = video.requestVideoFrameCallback((now, metadata) => {
        if (this.video !== video) return;
        let frame: VideoFrame | undefined;

        try {
          const pts = Math.round((Number.isFinite(metadata.expectedDisplayTime) ? metadata.expectedDisplayTime : now) * 1000);
          const size = `${video.videoWidth}/${video.videoHeight}`;
          const discontinuous = previousPTS === undefined || pts <= previousPTS || size !== previousSize ||
            (previousMediaTime !== undefined && metadata.mediaTime < previousMediaTime) ||
            (previousFrames !== undefined && metadata.presentedFrames > previousFrames + 1);
          const duration = previousPTS !== undefined && pts > previousPTS ? pts - previousPTS : undefined;
          frame = new VideoFrame(video, { timestamp: pts, ...(duration && { duration }) });
          previousPTS = pts;
          previousMediaTime = metadata.mediaTime;
          previousFrames = metadata.presentedFrames;
          previousSize = size;
          listener({ frame, discontinuous });
        } catch (error) {
          frame?.close();
          onError(error);
        }
        if (this.video === video) next();
      });
    };
    next();
    void video.play().catch(error => {
      if (this.video === video) onError(error);
    });
  }

  /**
   * 停止观察并释放媒体元素，不停止借用的 RTC 视频轨。
   */
  stop(): void {
    if (this.track && this.onEnded) this.track.removeEventListener("ended", this.onEnded);
    this.track = undefined;
    this.onEnded = undefined;
    const video = this.video;
    this.video = undefined;
    if (!video) return;
    if (this.callback !== undefined) video.cancelVideoFrameCallback(this.callback);
    this.callback = undefined;
    video.pause();
    video.srcObject = null;
    video.remove();
  }
}
