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
 * 音频线程复制出的 PCM 包及其接收端呈现时间。
 */
export interface RemoteAudioPacket {

  /**
   * S16LE 交错音频字节及格式。
   */
  data: Uint8Array;
  sampleRate: number;
  channels: number;
  samplesPerChannel: number;

  /**
   * 共享 performance 时间轴上的微秒时间。
   */
  presentationTimeStamp: number;

  /**
   * 音频输入、格式或采样时钟发生变化。
   */
  discontinuous: boolean;
}

/**
 * 以独立静音音频图读取远端原始音轨，不修改 RTC 播放器的音量或订阅。
 */
export class RemoteAudioFrameSource {

  /**
   * 音频上下文与当前输入图
   */
  private context?: AudioContext;

  /**
   * 当前输入轨的音频源。
   */
  private source?: MediaStreamAudioSourceNode;

  /**
   * PCM 复制处理器。
   */
  private processor?: AudioWorkletNode;

  /**
   * 保持音频图活动但不发声的输出节点。
   */
  private silence?: GainNode;

  /**
   * 借用轨道及其结束通知，释放时仅移除监听。
   */
  private track?: MediaStreamTrack;

  /**
   * 当前音轨结束后停止复制 PCM。
   */
  private onEnded?: () => void;

  /**
   * 连续性时钟与格式
   */
  private nextPTS?: number;

  /**
   * 上一包的采样率和声道数。
   */
  private format?: string;

  /**
   * 从用户手势调用链准备音频线程；失败或取消时释放已分配的资源。
   */
  async prepare(signal: AbortSignal): Promise<void> {
    if (typeof AudioContext === "undefined" || typeof AudioWorkletNode === "undefined") {
      throw new XmaxError(XmaxErrorCode.mediaError, "Remote PCM frames require AudioWorklet support");
    }
    const context = new AudioContext();
    this.context = context;
    let url: string | undefined;
    try {
      if (!context.audioWorklet) {
        throw new XmaxError(XmaxErrorCode.mediaError, "Remote PCM frames require a secure context with AudioWorklet");
      }
      const resumed = context.resume();
      url = URL.createObjectURL(new Blob([REMOTE_AUDIO_WORKLET], { type: "text/javascript" }));
      await this.wait(Promise.all([resumed, context.audioWorklet.addModule(url)]).then(() => {}), signal);
      if (context.state !== "running") {
        throw new XmaxError(XmaxErrorCode.mediaError, "Start remote media observation from a user gesture to unlock audio");
      }
    } catch (error) {
      await this.close();
      throw error;
    } finally {
      if (url) URL.revokeObjectURL(url);
    }
  }

  /**
   * 切换原始音轨，旧消息通过节点身份失效；没有音轨时不制造静音 PCM。
   */
  setTrack(track: MediaStreamTrack | undefined, listener: (packet: RemoteAudioPacket) => void): void {
    this.disconnect();
    const context = this.context;
    if (!context || !track || track.readyState === "ended") return;

    this.track = track;
    this.onEnded = () => this.disconnect();
    track.addEventListener("ended", this.onEnded, { once: true });

    const source = context.createMediaStreamSource(new MediaStream([track]));
    this.source = source;
    const processor = new AudioWorkletNode(context, "xmax-remote-audio", {
      numberOfInputs: 1, numberOfOutputs: 1, outputChannelCount: [1],
      channelCount: 2, channelCountMode: "max",
    });
    this.processor = processor;
    const silence = context.createGain();
    this.silence = silence;
    silence.gain.value = 0;
    processor.port.onmessage = event => {
      if (this.processor !== processor || context.state !== "running") return;
      const packet = this.convert(event.data, context);
      if (packet) listener(packet);
    };
    source.connect(processor);
    processor.connect(silence);
    silence.connect(context.destination);
  }

  /**
   * 释放当前音频图和共享上下文，不停止借用的 RTC 音轨。
   */
  async close(): Promise<void> {
    this.disconnect();
    const context = this.context;
    this.context = undefined;
    if (context && context.state !== "closed") await context.close();
  }

  /**
   * 取消输入和旧端口消息，并重新武装音频时间线。
   */
  private disconnect(): void {
    if (this.track && this.onEnded) this.track.removeEventListener("ended", this.onEnded);
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
   * 校验音频线程消息，以采样数推进连续时间；时钟跳变超过 100 ms 时重新锚定。
   */
  private convert(value: unknown, context: AudioContext): RemoteAudioPacket | undefined {
    const raw = value as {
      data?: ArrayBuffer; sampleRate?: number; channels?: number;
      samplesPerChannel?: number; frameIndex?: number; discontinuous?: boolean;
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
    return { data: new Uint8Array(data), sampleRate, channels, samplesPerChannel,
      presentationTimeStamp: pts, discontinuous };
  }

  /**
   * 为自动播放阻塞和模块加载设置有界等待，并响应监听取消。
   */
  private wait(promise: Promise<void>, signal: AbortSignal): Promise<void> {
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => finish(new XmaxError(XmaxErrorCode.timeout,
        "Remote audio initialization timed out; call setRemoteMediaFrameListener from a user gesture")), 3000);
      const abort = () => finish(new XmaxError(XmaxErrorCode.cancelled, "Remote media observation cancelled"));
      const finish = (error?: unknown) => {
        clearTimeout(timer);
        signal.removeEventListener("abort", abort);
        if (error) reject(error); else resolve();
      };
      promise.then(() => finish(), finish);
      signal.addEventListener("abort", abort, { once: true });
      if (signal.aborted) abort();
    });
  }
}
