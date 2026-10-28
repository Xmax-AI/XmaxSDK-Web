//
//  RealtimeExternalAudioFrame.ts
//  XmaxSDK
//
//  Author: 翁跃庭 (Yueting Weng)
//  GitHub: https://github.com/Xmax-AI/XmaxSDK-Web
//
//  Copyright (c) 2026 XMAX.AI PTE. LTD.
//

/**
 * A structural PCM input contract compatible with browser AudioData without requiring extra global
 * WebCodecs types.
 */
export interface RealtimeExternalAudioFrame {

  /**
   * The timestamp in microseconds on the shared source timeline.
   */
  readonly timestamp: number;

  /**
   * The sample rate, in samples per second.
   */
  readonly sampleRate: number;

  /**
   * The number of audio channels.
   */
  readonly numberOfChannels: number;

  /**
   * The number of sample frames in each channel.
   */
  readonly numberOfFrames: number;

  /**
   * The PCM sample format; null indicates that sample data is unavailable.
   */
  readonly format: string | null;

  /**
   * Copies a channel as planar floating-point PCM; the SDK no longer accesses source samples after this
   * returns.
   */
  copyTo(
    destination: Float32Array,
    options: {
      planeIndex: number;
      format: "f32-planar"
    }
  ): void;
}
