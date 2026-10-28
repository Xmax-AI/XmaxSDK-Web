//
//  RemoteMediaFrameController.ts
//  XmaxSDK
//
//  Author: 翁跃庭 (Yueting Weng)
//  GitHub: https://github.com/Xmax-AI/XmaxSDK-Web
//
//  Copyright (c) 2026 XMAX.AI PTE. LTD.
//

import { XmaxError, XmaxErrorCode } from "../../Foundation/Errors/XmaxError";
import { XmaxLogger } from "../../Foundation/Logging/XmaxLogger";
import { RemoteAudioFrameSource } from "../../Foundation/Media/Audio/RemoteAudioFrameSource";
import { RemoteVideoFrameSource } from "../../Foundation/Media/Video/RemoteVideoFrameSource";
import type { RemoteMediaTracks } from "../../Foundation/Media/RemoteMediaTracks";
import type { RealtimeMediaFrameListener } from "../../Service/Realtime/RealtimeMediaFrame";
import { RealtimeMediaFrameDispatcher } from "./RealtimeMediaFrameDispatcher";

/**
 * Coordinates original remote-media observation and bounded delivery without owning recording, files, or
 * duration limits.
 */
export class RemoteMediaFrameController {

  /**
   * The app's original-media listener.
   */
  private listener?: RealtimeMediaFrameListener;

  /**
   * The controller cancelling unfinished audio initialization.
   */
  private setup?: AbortController;

  /**
   * The prepared audio observation source.
   */
  private audio?: RemoteAudioFrameSource;

  /**
   * The original-video observer.
   */
  private readonly video = new RemoteVideoFrameSource();

  /**
   * The bounded media delivery queue.
   */
  private readonly dispatcher = new RealtimeMediaFrameDispatcher();

  /**
   * The RTC result-track binding currently supplied by transport.
   */
  private source?: RemoteMediaTracks;

  /**
   * The installed frame-observation binding.
   */
  private bound?: RemoteMediaTracks;

  /**
   * The shared audio/video ID for the current result stream.
   */
  private streamID?: string;

  /**
   * Whether this binding has reported an observation failure.
   */
  private reportedError = false;

  /**
   * Replaces or cancels observation; preparation failure rejects only this setup without terminating
   * generation.
   */
  async setListener(
    listener?: RealtimeMediaFrameListener
  ): Promise<void> {
    this.setup?.abort();
    const setup = new AbortController();
    this.setup = setup;
    this.listener = undefined;
    this.stopBinding();
    this.dispatcher.setListener(undefined);
    const previous = this.audio;
    this.audio = undefined;
    await previous?.close();
    if (setup.signal.aborted) {
      throw new XmaxError(
        XmaxErrorCode.cancelled,
        "Remote media listener replaced"
      );
    }
    if (!listener) {
      return;
    }

    if (typeof VideoFrame === "undefined" || typeof HTMLVideoElement === "undefined" ||
      typeof HTMLVideoElement.prototype.requestVideoFrameCallback !== "function") {
      throw new XmaxError(
        XmaxErrorCode.mediaError,
        "This browser cannot provide remote video frames"
      );
    }
    const audio = new RemoteAudioFrameSource();
    this.audio = audio;
    try {
      await audio.prepare(setup.signal);
      if (setup.signal.aborted) {
        throw new XmaxError(
          XmaxErrorCode.cancelled,
          "Remote media listener replaced"
        );
      }
      this.listener = listener;
      this.dispatcher.setListener(listener);
      this.bind(true);
    } catch (error) {
      if (this.audio === audio) {
        this.audio = undefined;
      }
      await audio.close();
      throw error;
    }
  }

  /**
   * Updates observation after stream, task, or audio-track changes; without a listener, records only the
   * binding.
   */
  setSource(
    source?: RemoteMediaTracks
  ): void {
    this.source = source;
    if (!this.listener || !this.audio) {
      return;
    }
    this.bind();
  }

  /**
   * Installs the current stream, preserving video observation and stream identity when only audio
   * changes.
   */
  private bind(
    strict = false
  ): void {
    const source = this.source;
    const previous = this.bound;
    if (!source) {
      this.stopBinding();
      return;
    }
    const sameStream = previous?.bindingID === source.bindingID && previous.userID === source.userID &&
      previous.videoTrack === source.videoTrack;
    if (sameStream && previous.audioTrack === source.audioTrack) {
      return;
    }
    if (!sameStream) {
      this.stopBinding();
      this.streamID = crypto.randomUUID();
      this.reportedError = false;
    }
    this.bound = source;
    const streamID = this.streamID!;
    try {
      if (!sameStream) {
        this.video.start(
          source.videoTrack,
          packet => {
            if (this.streamID !== streamID) {
              packet.frame.close();
              return;
            }
            const frame = Object.freeze({
              frame: packet.frame,
              presentationTimeStamp: packet.frame.timestamp,
              duration: packet.frame.duration ?? undefined
            });
            this.dispatcher.dispatch({
              streamID,
              isDiscontinuous: packet.discontinuous,
              content: {
                type: "video",
                frame
              },
              presentationTimeStamp: frame.presentationTimeStamp,
              duration: frame.duration
            });
          },
          error => this.report(error)
        );
      }
      this.audio!.setTrack(
        source.audioTrack,
        packet => {
          if (this.streamID !== streamID) {
            return;
          }
          const frame = Object.freeze({
            data: packet.data,
            sampleRate: packet.sampleRate,
            channels: packet.channels,
            samplesPerChannel: packet.samplesPerChannel,
            presentationTimeStamp: packet.presentationTimeStamp,
            duration: packet.samplesPerChannel * 1_000_000 / packet.sampleRate
          });
          this.dispatcher.dispatch({
            streamID,
            isDiscontinuous: packet.discontinuous,
            content: {
              type: "audio",
              frame
            },
            presentationTimeStamp: frame.presentationTimeStamp,
            duration: frame.duration
          });
        }
      );
    } catch (error) {
      this.stopBinding();
      if (strict) {
        throw error;
      }
      this.report(error);
    }
  }

  /**
   * Stops obsolete observation and queued packets without changing borrowed RTC tracks.
   */
  private stopBinding(): void {
    this.streamID = undefined;
    this.bound = undefined;
    this.video.stop();
    this.audio?.setTrack(
      undefined,
      () => { }
    );
    this.dispatcher.reset();
  }

  /**
   * Logs an observation failure without terminating playback or generation.
   */
  private report(
    error: unknown
  ): void {
    if (this.reportedError) {
      return;
    }
    this.reportedError = true;
    XmaxLogger.render.warning(() => `Remote media frame observation failed: ${XmaxError.from(error).message}`);
  }
}
