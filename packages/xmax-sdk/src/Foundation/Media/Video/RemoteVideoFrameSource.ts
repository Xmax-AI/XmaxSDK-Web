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
 * An original decoded frame and its continuity information.
 */
export interface RemoteVideoPacket {

  /**
   * The copied frame whose ownership passes to the caller.
   */
  frame: VideoFrame;

  /**
   * Whether frame callbacks or the presentation clock were discontinuous.
   */
  discontinuous: boolean;
}

/**
 * Observes an original track through a separate muted video element, independently of SDK views.
 * Presentation callbacks do not guarantee observation of every received or decoded frame.
 */
export class RemoteVideoFrameSource {

  /**
   * The video element used for independent frame observation.
   */
  private video?: HTMLVideoElement;

  /**
   * The pending frame-observation callback.
   */
  private callback?: number;

  /**
   * The borrowed input video track.
   */
  private track?: MediaStreamTrack;

  /**
   * The callback ending observation when the borrowed track ends.
   */
  private onEnded?: () => void;

  /**
   * Starts original-video observation without affecting the main player; the owner isolates observation
   * failures.
   */
  start(
    track: MediaStreamTrack,
    listener: (
      packet: RemoteVideoPacket
    ) => void,
    onError: (
      error: unknown
    ) => void
  ): void {
    this.stop();
    if (typeof VideoFrame === "undefined" || typeof HTMLVideoElement === "undefined" ||
      typeof HTMLVideoElement.prototype.requestVideoFrameCallback !== "function") {
      throw new XmaxError(
        XmaxErrorCode.mediaError,
        "Remote video frames require VideoFrame and requestVideoFrameCallback"
      );
    }
    const video = document.createElement("video");
    this.video = video;
    this.track = track;
    this.onEnded = () => this.stop();
    track.addEventListener(
      "ended",
      this.onEnded,
      { once: true }
    );
    video.muted = true;
    video.playsInline = true;
    video.autoplay = true;
    video.srcObject = new MediaStream([track]);
    Object.assign(
      video.style,
      {
        position: "fixed",
        top: "0",
        left: "0",
        width: "1px",
        height: "1px",
        opacity: "0",
        pointerEvents: "none"
      }
    );
    video.setAttribute(
      "aria-hidden",
      "true"
    );
    document.body.appendChild(video);
    let previousPTS: number | undefined;
    let previousMediaTime: number | undefined;
    let previousFrames: number | undefined;
    let previousSize: string | undefined;
    const next = () => {
      this.callback = video.requestVideoFrameCallback((
        now,
        metadata
      ) => {
        if (this.video !== video) {
          return;
        }
        let frame: VideoFrame | undefined;

        try {
          const pts = Math.round((Number.isFinite(metadata.expectedDisplayTime) ? metadata.expectedDisplayTime : now) * 1000);
          const size = `${video.videoWidth}/${video.videoHeight}`;
          const discontinuous = previousPTS === undefined || pts <= previousPTS || size !== previousSize ||
            (previousMediaTime !== undefined && metadata.mediaTime < previousMediaTime) ||
            (previousFrames !== undefined && metadata.presentedFrames > previousFrames + 1);
          const duration = previousPTS !== undefined && pts > previousPTS ? pts - previousPTS : undefined;
          frame = new VideoFrame(
            video,
            {
              timestamp: pts,
              ...(duration && { duration })
            }
          );
          previousPTS = pts;
          previousMediaTime = metadata.mediaTime;
          previousFrames = metadata.presentedFrames;
          previousSize = size;
          listener({
            frame,
            discontinuous
          });
        } catch (error) {
          frame?.close();
          onError(error);
        }
        if (this.video === video) {
          next();
        }
      });
    };
    next();
    void video.play().catch(error => {
      if (this.video === video) {
        onError(error);
      }
    });
  }

  /**
   * Stops observation and releases its media element without stopping the borrowed RTC video track.
   */
  stop(): void {
    if (this.track && this.onEnded) {
      this.track.removeEventListener(
        "ended",
        this.onEnded
      );
    }
    this.track = undefined;
    this.onEnded = undefined;
    const video = this.video;
    this.video = undefined;
    if (!video) {
      return;
    }
    if (this.callback !== undefined) {
      video.cancelVideoFrameCallback(this.callback);
    }
    this.callback = undefined;
    video.pause();
    video.srcObject = null;
    video.remove();
  }
}
