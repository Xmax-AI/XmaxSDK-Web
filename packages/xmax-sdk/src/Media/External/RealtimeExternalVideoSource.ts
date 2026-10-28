//
//  RealtimeExternalVideoSource.ts
//  XmaxSDK
//
//  Author: 翁跃庭 (Yueting Weng)
//  GitHub: https://github.com/Xmax-AI/XmaxSDK-Web
//
//  Copyright (c) 2026 XMAX.AI PTE. LTD.
//

import type { RealtimeExternalAudioFrame } from "../../Foundation/Media/Audio/RealtimeExternalAudioFrame";
import type { RealtimeVideoFormat } from "../../Service/Realtime/RealtimeVideoFormat";

/**
 * Mutually exclusive external-frame-source and compatibility-track inputs with separate ownership
 * contracts.
 */
export type RealtimeExternalVideoStreamOptions =
  | {

    /**
     * The app-owned source that submits video and optional audio frames.
     */
    source: RealtimeExternalVideoSource;

    /**
     * Excludes a compatibility track when a frame source is supplied.
     */
    videoTrack?: never;

    /**
     * Uses the frame source's format instead of a separate format.
     */
    videoFormat?: never
  }
  | {

    /**
     * The app-owned video track used by the compatibility input path.
     */
    videoTrack: MediaStreamTrack;

    /**
     * The compatibility track's declared video format.
     */
    videoFormat: RealtimeVideoFormat;

    /**
     * Excludes a frame source when a compatibility track is supplied.
     */
    source?: never
  };

/**
 * An app-owned capture, decoding, or processing source that does not request SDK device access or play
 * input audio. videoFormat and hasAudio stay fixed for one binding. Audio and video timestamps share one
 * monotonic timeline.
 */
export interface RealtimeExternalVideoSource {

  /**
   * The original dimensions, frame rate, and encoding settings; your app applies orientation and
   * mirroring to the pixels.
   */
  readonly videoFormat: RealtimeVideoFormat;

  /**
   * Whether audio is submitted through the sink; defaults to false.
   */
  readonly hasAudio?: boolean;

  /**
   * Installs the sink and resolves when delivery is possible, without waiting for a frame or generation.
   * Submit at realtime pace; disconnected video input may continue for preview.
   */
  start(
    sink: RealtimeExternalFrameSink
  ): Promise<void>;

  /**
   * Stops delivery and drops the sink reference idempotently. Your app retains capture-device and player
   * ownership.
   */
  stop(): Promise<void>;
}

/**
 * The input sink for one source binding. Your app may close original frames after submission returns.
 * VideoFrame and AudioData timestamps are nonnegative microseconds and must remain increasing across
 * loops and seeks.
 */
export interface RealtimeExternalFrameSink {

  /**
   * The fixed area-limited, four-pixel-aligned media format; submitted frames still use
   * source.videoFormat dimensions.
   */
  readonly videoFormat: RealtimeVideoFormat;

  /**
   * Whether input is accepted. Disconnect retains acceptance; unbinding or failure permanently disables
   * it.
   */
  readonly isRequestingFrames: boolean;

  /**
   * Submits a source-sized frame, retaining a copy and scaling it to the media format without
   * guaranteeing every frame is delivered. Invalid, duplicate, or decreasing timestamps are ignored.
   * Submit at realtime pace, no more than two seconds ahead.
   */
  pushVideo(
    frame: VideoFrame
  ): void;

  /**
   * Submits decoded PCM only when hasAudio is true; compressed audio is unsupported. Accepts 8–192 kHz,
   * 1–8 channels, and packets no longer than one second, with a fixed format per binding. Samples are
   * copied, mixed to mono, resampled, and scheduled by AudioWorklet. Only published audio is uploaded;
   * no backlog is retained for reconnection. Invalid or overlapping timestamps are ignored and gaps
   * produce silence without timeline compression.
   */
  pushAudio(
    frame: RealtimeExternalAudioFrame
  ): void;

  /**
   * Reports an unrecoverable source failure, ending the connection and releasing local media.
   */
  reportError(
    error: Error
  ): void;
}
