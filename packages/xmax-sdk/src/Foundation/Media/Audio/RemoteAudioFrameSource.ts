//
//  RemoteAudioFrameSource.ts
//  XmaxSDK
//
//  Author: 翁跃庭 (Yueting Weng)
//  GitHub: https://github.com/Xmax-AI/XmaxSDK-Web
//
//  Copyright (c) 2026 XMAX.AI PTE. LTD.
//

import { XmaxError, XmaxErrorCode } from "../../Errors/XmaxError";
import { REMOTE_AUDIO_WORKLET } from "./RemoteAudioWorklet";

/**
 * A copied PCM packet and its receiver presentation timestamp.
 */
export interface RemoteAudioPacket {

  /**
   * The interleaved S16LE sample bytes.
   */
  data: Uint8Array;

  /**
   * The sample rate, in samples per second.
   */
  sampleRate: number;

  /**
   * The number of interleaved audio channels.
   */
  channels: number;

  /**
   * The number of samples per channel in this packet.
   */
  samplesPerChannel: number;

  /**
   * The timestamp on the shared performance timeline, in microseconds.
   */
  presentationTimeStamp: number;

  /**
   * Whether the input, format, or sampling clock changed.
   */
  discontinuous: boolean;
}

/**
 * Reads original remote audio through a separate muted graph without changing RTC playback volume or
 * subscriptions.
 */
export class RemoteAudioFrameSource {

  /**
   * The audio context owning the current input graph.
   */
  private context?: AudioContext;

  /**
   * The current input track's audio source node.
   */
  private source?: MediaStreamAudioSourceNode;

  /**
   * The worklet copying PCM samples.
   */
  private processor?: AudioWorkletNode;

  /**
   * The silent output node keeping the audio graph active.
   */
  private silence?: GainNode;

  /**
   * The borrowed input audio track, whose listeners are removed during cleanup.
   */
  private track?: MediaStreamTrack;

  /**
   * The callback stopping PCM observation when the current track ends.
   */
  private onEnded?: () => void;

  /**
   * The expected next presentation timestamp.
   */
  private nextPTS?: number;

  /**
   * The previous packet's sample rate and channel count.
   */
  private format?: string;

  /**
   * Prepares audio processing from a user gesture and releases allocated resources on failure or
   * cancellation.
   */
  async prepare(
    signal: AbortSignal
  ): Promise<void> {
    if (typeof AudioContext === "undefined" || typeof AudioWorkletNode === "undefined") {
      throw new XmaxError(
        XmaxErrorCode.mediaError,
        "Remote PCM frames require AudioWorklet support"
      );
    }

    const context = new AudioContext();
    this.context = context;
    let url: string | undefined;

    try {
      if (!context.audioWorklet) {
        throw new XmaxError(
          XmaxErrorCode.mediaError,
          "Remote PCM frames require a secure context with AudioWorklet"
        );
      }
      const resumed = context.resume();
      url = URL.createObjectURL(new Blob(
        [REMOTE_AUDIO_WORKLET],
        { type: "text/javascript" }
      ));
      await this.wait(
        Promise.all([resumed, context.audioWorklet.addModule(url)]).then(() => { }),
        signal
      );
      if (context.state !== "running") {
        throw new XmaxError(
          XmaxErrorCode.mediaError,
          "Start remote media observation from a user gesture to unlock audio"
        );
      }
    } catch (error) {
      await this.close();
      throw error;
    } finally {
      if (url) {
        URL.revokeObjectURL(url);
      }
    }
  }

  /**
   * Replaces the original input track, invalidating obsolete node messages without synthesizing PCM when
   * audio is absent.
   */
  setTrack(
    track: MediaStreamTrack | undefined,
    listener: (
      packet: RemoteAudioPacket
    ) => void
  ): void {
    this.disconnect();
    const context = this.context;
    if (!context || !track || track.readyState === "ended") {
      return;
    }

    this.track = track;
    this.onEnded = () => this.disconnect();
    track.addEventListener(
      "ended",
      this.onEnded,
      { once: true }
    );

    const source = context.createMediaStreamSource(new MediaStream([track]));
    this.source = source;
    const processor = new AudioWorkletNode(
      context,
      "xmax-remote-audio",
      {
        numberOfInputs: 1,
        numberOfOutputs: 1,
        outputChannelCount: [1],
        channelCount: 2,
        channelCountMode: "max",
      }
    );
    this.processor = processor;
    const silence = context.createGain();
    this.silence = silence;
    silence.gain.value = 0;
    processor.port.onmessage = event => {
      if (this.processor !== processor || context.state !== "running") {
        return;
      }
      const packet = this.convert(
        event.data,
        context
      );
      if (packet) {
        listener(packet);
      }
    };
    source.connect(processor);
    processor.connect(silence);
    silence.connect(context.destination);
  }

  /**
   * Releases the audio graph and context without stopping the borrowed RTC track.
   */
  async close(): Promise<void> {
    this.disconnect();
    const context = this.context;
    this.context = undefined;
    if (context && context.state !== "closed") {
      await context.close();
    }
  }

  /**
   * Disconnects input, invalidates old port messages, and resets audio continuity.
   */
  private disconnect(): void {
    if (this.track && this.onEnded) {
      this.track.removeEventListener(
        "ended",
        this.onEnded
      );
    }
    this.track = undefined;
    this.onEnded = undefined;
    const processor = this.processor;
    this.processor = undefined;
    if (processor) {
      processor.port.onmessage = null;
      processor.port.close();
      processor.disconnect();
    }
    this.source?.disconnect();
    this.silence?.disconnect();
    this.source = undefined;
    this.silence = undefined;
    this.nextPTS = undefined;
    this.format = undefined;
  }

  /**
   * Validates worklet packets and advances time by sample count, reanchoring clock jumps over 100 ms.
   */
  private convert(
    value: unknown,
    context: AudioContext
  ): RemoteAudioPacket | undefined {
    const raw = value as {
      data?: ArrayBuffer;
      sampleRate?: number;
      channels?: number;
      samplesPerChannel?: number;
      frameIndex?: number;
      discontinuous?: boolean;
    } | null;
    const { data, sampleRate, channels, samplesPerChannel, frameIndex } = raw ?? {};
    if (!(data instanceof ArrayBuffer) || !sampleRate || sampleRate < 8000 || sampleRate > 192000 ||
      !Number.isInteger(sampleRate) || !channels || ![1, 2].includes(channels) ||
      !samplesPerChannel || !Number.isInteger(samplesPerChannel) || samplesPerChannel > sampleRate ||
      frameIndex === undefined || !Number.isSafeInteger(frameIndex) || frameIndex < 0 ||
      data.byteLength !== samplesPerChannel * channels * 2) {
      this.nextPTS = undefined;
      return undefined;
    }

    const output = context.getOutputTimestamp?.();
    const validClock = output && Number.isFinite(output.contextTime) &&
      Number.isFinite(output.performanceTime) && output.performanceTime! > 0;
    const contextTime = validClock ? output.contextTime! : context.currentTime;
    const performanceTime = validClock ? output.performanceTime! : performance.now();
    const nativePTS = Math.round(performanceTime * 1000 + (frameIndex / sampleRate - contextTime) * 1_000_000);
    if (!Number.isFinite(nativePTS)) {
      this.nextPTS = undefined;
      return undefined;
    }
    const format = `${sampleRate}/${channels}`;
    const discontinuous = raw?.discontinuous === true || this.nextPTS === undefined || this.format !== format ||
      Math.abs(nativePTS - this.nextPTS) > 100_000;
    const pts = discontinuous ? nativePTS : this.nextPTS!;
    this.nextPTS = pts + samplesPerChannel * 1_000_000 / sampleRate;
    this.format = format;
    return {
      data: new Uint8Array(data),
      sampleRate,
      channels,
      samplesPerChannel,
      presentationTimeStamp: pts,
      discontinuous
    };
  }

  /**
   * Bounds module-loading and autoplay waits while observing cancellation.
   */
  private wait(
    promise: Promise<void>,
    signal: AbortSignal
  ): Promise<void> {
    return new Promise((
      resolve,
      reject
    ) => {
      const timer = setTimeout(
        () => finish(new XmaxError(
          XmaxErrorCode.timeout,
          "Remote audio initialization timed out; call setRemoteMediaFrameListener from a user gesture"
        )),
        3000
      );
      const abort = () => finish(new XmaxError(
        XmaxErrorCode.cancelled,
        "Remote media observation cancelled"
      ));
      const finish = (error?: unknown) => {
        clearTimeout(timer);
        signal.removeEventListener(
          "abort",
          abort
        );
        if (error) {
          reject(error);
        } else {
          resolve();
        }
      };
      promise.then(
        () => finish(),
        finish
      );
      signal.addEventListener(
        "abort",
        abort,
        { once: true }
      );
      if (signal.aborted) {
        abort();
      }
    });
  }
}
