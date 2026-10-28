//
//  ExternalAudioFrameSource.ts
//  XmaxSDK
//
//  Author: 翁跃庭 (Yueting Weng)
//  GitHub: https://github.com/Xmax-AI/XmaxSDK-Web
//
//  Copyright (c) 2026 XMAX.AI PTE. LTD.
//

import { XmaxError, XmaxErrorCode } from "../../Errors/XmaxError";
import { waitForMediaOperation } from "../MediaOperation";
import { EXTERNAL_AUDIO_WORKLET } from "./ExternalAudioWorklet";
import type { RealtimeExternalAudioFrame } from "./RealtimeExternalAudioFrame";

/**
 * Mixes external PCM to mono and creates an RTC audio track without capturing devices or connecting
 * speakers. A browser may label the output stereo; both channels then carry the same content.
 */
export class ExternalAudioFrameSource {

  /**
   * The audio context owning the processing graph and output track.
   */
  private context?: AudioContext;

  /**
   * The worklet that schedules copied PCM packets.
   */
  private processor?: AudioWorkletNode;

  /**
   * The output node that exposes the SDK-owned audio track.
   */
  private destination?: MediaStreamAudioDestinationNode;

  /**
   * The unexpected-output-end callback, removed before intentional cleanup.
   */
  private onEnded?: () => void;

  /**
   * The fixed PCM input format for the current binding.
   */
  private format?: string;

  /**
   * The expected next input timestamp, in source microseconds.
   */
  private nextInputTime?: number;

  /**
   * Whether incoming PCM is currently forwarded to the worklet.
   */
  private published = false;

  /**
   * The sequence identifying packets within the bounded in-flight audio budget.
   */
  private sequence = 0;

  /**
   * The queue revision used to ignore acknowledgments from earlier resets.
   */
  private epoch = 0;

  /**
   * The total duration of unacknowledged audio packets, in seconds.
   */
  private pendingSeconds = 0;

  /**
   * Unacknowledged packet durations, in seconds, indexed by sequence.
   */
  private readonly pending = new Map<number, number>();

  /**
   * The audio sampling clock, in microseconds, shared by video source-time mapping.
   */
  get nowUs(): number {
    return (this.context?.currentTime ?? 0) * 1_000_000;
  }

  /**
   * The SDK-owned audio track used as RTC input.
   */
  get track(): MediaStreamTrack | undefined {
    return this.destination?.stream.getAudioTracks()[0];
  }

  /**
   * Prepares the audio graph from a user gesture, releasing resources if loading, cancellation, or
   * autoplay restrictions prevent setup.
   */
  async prepare(
    signal: AbortSignal,
    onError: (
      error: XmaxError
    ) => void
  ): Promise<void> {
    if (typeof AudioContext === "undefined" || typeof AudioWorkletNode === "undefined") {
      throw new XmaxError(
        XmaxErrorCode.mediaError,
        "External PCM input requires AudioWorklet support"
      );
    }

    const context = new AudioContext({ sampleRate: 48000 });
    this.context = context;
    let url: string | undefined;

    try {
      if (!context.audioWorklet) {
        throw new XmaxError(
          XmaxErrorCode.mediaError,
          "External PCM input requires a secure context with AudioWorklet"
        );
      }
      url = URL.createObjectURL(new Blob(
        [EXTERNAL_AUDIO_WORKLET],
        { type: "text/javascript" }
      ));
      await waitForMediaOperation(
        Promise.all([context.resume(), context.audioWorklet.addModule(url)]),
        signal,
        3000,
        "External audio initialization; start from a user gesture"
      );
      if (context.state !== "running") {
        throw new XmaxError(
          XmaxErrorCode.mediaError,
          "External audio must be initialized from a user gesture"
        );
      }

      const destination = new MediaStreamAudioDestinationNode(
        context,
        {
          channelCount: 1,
          channelCountMode: "explicit"
        }
      );
      this.destination = destination;
      const processor = new AudioWorkletNode(
        context,
        "xmax-external-audio",
        {
          numberOfInputs: 0,
          numberOfOutputs: 1,
          outputChannelCount: [1],
        }
      );
      this.processor = processor;
      processor.port.onmessage = ({ data }) => {
        if (this.processor !== processor || data?.epoch !== this.epoch) {
          return;
        }
        this.pendingSeconds = Math.max(0, this.pendingSeconds - (this.pending.get(data.id) ?? 0));
        this.pending.delete(data.id);
      };
      processor.onprocessorerror = () => onError(new XmaxError(
        XmaxErrorCode.mediaError,
        "External audio processor failed"
      ));
      processor.connect(destination);
      if (!this.track || this.track.readyState !== "live") {
        throw new XmaxError(
          XmaxErrorCode.mediaError,
          "External audio did not produce a live track"
        );
      }
      this.onEnded = () => onError(new XmaxError(
        XmaxErrorCode.mediaError,
        "External audio output ended"
      ));
      this.track.addEventListener(
        "ended",
        this.onEnded
      );
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
   * Consumes input only while published, discarding queued audio on state changes instead of
   * accumulating it for reconnection.
   */
  setPublished(
    published: boolean
  ): void {
    if (this.published === published) {
      return;
    }
    this.published = published;
    this.reset();
  }

  /**
   * Clears worklet queues and in-flight budgets without changing input format or publication state.
   */
  reset(): void {
    this.pending.clear();
    this.pendingSeconds = 0;
    this.processor?.port.postMessage({
      type: "reset",
      epoch: ++this.epoch
    });
  }

  /**
   * Copies and downmixes PCM synchronously before scheduling it on the audio thread. Invalid or
   * overlapping timestamps are ignored; format changes throw.
   */
  push(
    frame: RealtimeExternalAudioFrame,
    mapTime: (
      timestamp: number
    ) => number
  ): void {
    const timestamp = frame.timestamp;
    if (!Number.isSafeInteger(timestamp) || timestamp < 0) {
      return;
    }

    const { sampleRate: rate, numberOfChannels: channels, numberOfFrames: frames, format } = frame;
    if (!format || !Number.isInteger(rate) || rate < 8000 || rate > 192000 ||
      !Number.isInteger(channels) || channels < 1 || channels > 8 || !Number.isInteger(frames) || frames < 1 || frames > rate) {
      throw new XmaxError(
        XmaxErrorCode.mediaError,
        "External audio requires live PCM at 8–192 kHz, 1–8 channels, at most one second per packet"
      );
    }

    const identity = `${format}/${rate}/${channels}`;
    if (this.format && this.format !== identity) {
      throw new XmaxError(
        XmaxErrorCode.mediaError,
        "External audio format must remain unchanged during a source binding"
      );
    }
    this.format = identity;
    if (this.nextInputTime !== undefined && timestamp < this.nextInputTime - 500_000 / rate) {
      return;
    }
    const seconds = frames / rate;
    this.nextInputTime = timestamp + seconds * 1_000_000;

    const context = this.context;
    const processor = this.processor;
    if (!this.published || !context || !processor) {
      return;
    }
    if (context.state !== "running") {
      throw new XmaxError(
        XmaxErrorCode.mediaError,
        "External audio context is suspended"
      );
    }

    const time = mapTime(timestamp);
    if (time + seconds * 1_000_000 <= this.nowUs) {
      return;
    }
    if (time > this.nowUs + 2_000_000 || this.pendingSeconds + seconds > 2 || this.pending.size >= 256) {
      throw new XmaxError(
        XmaxErrorCode.mediaError,
        "External audio must be paced in real time; pending audio exceeds two seconds or 256 packets"
      );
    }

    const samples = new Float32Array(frames);
    const plane = new Float32Array(frames);
    for (let channel = 0; channel < channels; channel++) {
      frame.copyTo(
        plane,
        {
          planeIndex: channel,
          format: "f32-planar"
        }
      );
      for (let i = 0; i < frames; i++) {
        const value = Number.isFinite(plane[i]) ? plane[i]! : 0;
        samples[i]! += Math.max(-1, Math.min(1, value)) / channels;
      }
    }

    const id = ++this.sequence;
    const start = Math.round(time * context.sampleRate / 1_000_000);
    this.pending.set(
      id,
      seconds
    );
    this.pendingSeconds += seconds;
    processor.port.postMessage(
      {
        type: "packet",
        id,
        epoch: this.epoch,
        samples,
        rate,
        start,
        end: start + Math.round(seconds * context.sampleRate)
      },
      [samples.buffer]
    );
  }

  /**
   * Releases SDK audio tracks, processing nodes, and context without touching your app's source audio.
   */
  async close(): Promise<void> {
    this.published = false;
    const context = this.context;
    this.context = undefined;

    if (this.onEnded) {
      this.track?.removeEventListener(
        "ended",
        this.onEnded
      );
      this.onEnded = undefined;
    }
    this.destination?.stream.getTracks().forEach(track => track.stop());
    this.destination?.disconnect();
    this.destination = undefined;

    if (this.processor) {
      this.processor.onprocessorerror = null;
      this.processor.port.onmessage = null;
      this.processor.port.close();
      this.processor.disconnect();
      this.processor = undefined;
    }

    this.pending.clear();
    this.pendingSeconds = 0;
    if (context && context.state !== "closed") {
      await waitForMediaOperation(
        context.close(),
        new AbortController().signal,
        2000,
        "External audio close"
      );
    }
  }
}
