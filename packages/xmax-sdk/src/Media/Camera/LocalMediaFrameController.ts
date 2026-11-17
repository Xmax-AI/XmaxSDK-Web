//
//  LocalMediaFrameController.ts
//  XmaxSDK
//
//  Author: 翁跃庭 (Yueting Weng)
//  GitHub: https://github.com/Xmax-AI/XmaxSDK-Web
//
//  Copyright (c) 2026 XMAX.AI PTE. LTD.
//

import { XmaxError, XmaxErrorCode } from "../../Foundation/Errors/XmaxError";
import { XmaxLogger } from "../../Foundation/Logging/XmaxLogger";
import { AudioTrackFrameSource } from "../../Foundation/Media/Audio/AudioTrackFrameSource";
import { VideoTrackFrameSource } from "../../Foundation/Media/Video/VideoTrackFrameSource";
import type { RealtimeMediaFrameListener } from "../../Service/Realtime/RealtimeMediaFrame";
import { RealtimeMediaFrameDispatcher } from "../RealtimeMediaFrameDispatcher";

/**
 * Observes the SDK camera and optional microphone before RTC encoding.
 */
export class LocalMediaFrameController {

  /** The video frame reader and bounded callback queue. */
  private readonly video = new VideoTrackFrameSource();
  private readonly dispatcher = new RealtimeMediaFrameDispatcher();

  /** The borrowed capture tracks, which may arrive after registration. */
  private videoTrack?: MediaStreamTrack;
  private audioTrack?: MediaStreamTrack;

  /** The active audio reader and its cancellable setup. */
  private audio?: { source: AudioTrackFrameSource; setup: AbortController };

  /** The current video binding shared by both kinds of frame. */
  private streamID?: string;

  /** Whether the app is observing capture. */
  private observing = false;

  /**
   * Replaces the observer and binds any active capture. Passing undefined releases the frame readers.
   */
  async setListener(
    listener?: RealtimeMediaFrameListener
  ): Promise<void> {
    if (listener && (typeof VideoFrame === "undefined" || typeof HTMLVideoElement === "undefined" ||
      typeof HTMLVideoElement.prototype.requestVideoFrameCallback !== "function")) {
      throw new XmaxError(
        XmaxErrorCode.mediaError,
        "This browser cannot provide local video frames"
      );
    }

    this.stopVideo();
    const closingAudio = this.stopAudio();
    this.observing = Boolean(listener);
    this.dispatcher.setListener(listener);
    try {
      if (this.observing) {
        this.startVideo();
        void this.startAudio();
      }
    } catch (error) {
      this.stopVideo();
      this.observing = false;
      this.dispatcher.setListener(undefined);
      throw XmaxError.from(error);
    } finally {
      await closingAudio;
    }
  }

  /**
   * Replaces capture tracks without waiting for observation or handing their ownership to the reader.
   */
  setSource(
    videoTrack?: MediaStreamTrack,
    audioTrack?: MediaStreamTrack
  ): void {
    const videoChanged = this.videoTrack !== videoTrack;
    const audioChanged = this.audioTrack !== audioTrack;
    this.videoTrack = videoTrack;
    this.audioTrack = audioTrack;
    if (!this.observing || (!videoChanged && !audioChanged)) {
      return;
    }

    if (audioChanged) {
      void this.stopAudio();
    }
    this.dispatcher.reset();
    if (videoChanged) {
      this.stopVideo();
      try {
        this.startVideo();
      } catch (error) {
        this.stopVideo();
        this.report(error, "video");
      }
    }
    void this.startAudio();
  }

  /**
   * Starts observation of the current camera track.
   */
  private startVideo(): void {
    const track = this.videoTrack;
    if (!track || track.readyState === "ended") {
      return;
    }

    const streamID = crypto.randomUUID();
    let reportedError = false;
    this.streamID = streamID;
    this.video.start(
      track,
      packet => {
        if (this.streamID !== streamID) {
          packet.frame.close();
          return;
        }
        this.dispatcher.dispatchVideo(streamID, packet);
      },
      error => {
        if (this.streamID === streamID && !reportedError) {
          reportedError = true;
          this.report(error, "video");
        }
      }
    );
  }

  /**
   * Starts PCM handling only when there is a live microphone track.
   */
  private async startAudio(): Promise<void> {
    const track = this.audioTrack;
    if (this.audio || !track || track.readyState === "ended" || !this.streamID) {
      return;
    }

    const source = new AudioTrackFrameSource();
    const setup = new AbortController();
    this.audio = { source, setup };
    try {
      await source.prepare(setup.signal);
      if (!setup.signal.aborted) {
        source.setTrack(
          track,
          packet => {
            const streamID = this.streamID;
            if (streamID && !setup.signal.aborted) {
              this.dispatcher.dispatchAudio(streamID, packet);
            }
          }
        );
      }
    } catch (error) {
      if (!setup.signal.aborted) {
        this.report(error, "audio");
        await this.stopAudio();
      }
    }
  }

  /**
   * Ends video observation and invalidates callbacks from that binding.
   */
  private stopVideo(): void {
    this.streamID = undefined;
    this.video.stop();
  }

  /**
   * Cancels audio setup and releases the audio graph immediately.
   */
  private async stopAudio(): Promise<void> {
    const audio = this.audio;
    this.audio = undefined;
    audio?.setup.abort();
    try {
      await audio?.source.close();
    } catch (error) {
      this.report(error, "audio");
    }
  }

  /**
   * Reports observation errors independently of camera and connection failures.
   */
  private report(
    error: unknown,
    kind: "audio" | "video"
  ): void {
    XmaxLogger.media.warning(() => `Local ${kind} frame observation failed: ${XmaxError.from(error).message}`);
  }
}
