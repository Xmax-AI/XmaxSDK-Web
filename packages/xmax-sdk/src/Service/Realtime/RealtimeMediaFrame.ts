//
//  RealtimeMediaFrame.ts
//  XmaxSDK
//
//  Author: 翁跃庭 (Yueting Weng)
//  GitHub: https://github.com/Xmax-AI/XmaxSDK-Web
//
//  Copyright (c) 2026 XMAX.AI PTE. LTD.
//

/**
 * A copied PCM audio packet containing interleaved signed 16-bit little-endian samples.
 */
export interface RealtimeAudioFrame {

  /**
   * The sample bytes, which your app may retain after the callback returns.
   */
  readonly data: Uint8Array;

  /**
   * The sample rate per channel, in hertz.
   */
  readonly sampleRate: number;

  /**
   * The number of interleaved channels.
   */
  readonly channels: number;

  /**
   * The number of samples per channel in this packet.
   */
  readonly samplesPerChannel: number;

  /**
   * The first sample's time on the receiver presentation timeline, in microseconds; it need not start at
   * zero.
   */
  readonly presentationTimeStamp: number;

  /**
   * The duration derived from the sample count and sample rate, in microseconds.
   */
  readonly duration: number;
}

/**
 * An original decoded remote video frame without mirroring, cropping, or UI overlays.
 */
export interface RealtimeVideoFrame {

  /**
   * The frame owned by your app. Close it after use or asynchronous encoding completes.
   */
  readonly frame: VideoFrame;

  /**
   * The receiver presentation time, in microseconds, using the same time base as audio.
   */
  readonly presentationTimeStamp: number;

  /**
   * The suggested presentation duration, in microseconds; omitted when unknown.
   */
  readonly duration?: number;
}

/**
 * One remote media packet, not a paired audio/video sample. Synchronize packets using their timestamps
 * relative to a common recording origin.
 */
export interface RealtimeMediaFrame {

  /**
   * The identifier shared by audio and video in one result-stream binding; changes on stream replacement
   * or reconnection.
   */
  readonly streamID: string;

  /**
   * Whether this is the track's first output or follows a format, clock, or output-drop discontinuity.
   * XmaxSDK does not compress the timeline.
   */
  readonly isDiscontinuous: boolean;

  /**
   * The audio packet or video frame.
   */
  readonly content:
  | {

    /**
     * Identifies a copied PCM audio packet.
     */
    readonly type: "audio";

    /**
     * The audio samples and their receiver presentation timestamp.
     */
    readonly frame: RealtimeAudioFrame
  }
  | {

    /**
     * Identifies a decoded video frame.
     */
    readonly type: "video";

    /**
     * The video frame whose ownership is transferred to your app.
     */
    readonly frame: RealtimeVideoFrame
  };

  /**
   * The timestamp in microseconds, equal to content.frame.presentationTimeStamp.
   */
  readonly presentationTimeStamp: number;

  /**
   * The packet duration, in microseconds; omitted for video when unknown.
   */
  readonly duration?: number;
}

/**
 * Receives packets in delivery order, without guaranteeing timestamp order across tracks. Keep callbacks
 * lightweight and queue asynchronous work in your app. Your app owns delivered video frames and may
 * retain audio data.
 */
export type RealtimeMediaFrameListener = (
  frame: RealtimeMediaFrame
) => void;
