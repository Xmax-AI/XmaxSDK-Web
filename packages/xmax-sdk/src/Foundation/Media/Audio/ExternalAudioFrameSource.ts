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
 * 将外部 PCM 混成单声道并生成 RTC 音轨，不采集设备或连接扬声器。
 * 浏览器可能将输出轨声明为双声道，此时两路内容相同。
 */
export class ExternalAudioFrameSource {

  /**
   * 浏览器音频图与输出轨道
   */
  private context?: AudioContext;
  private processor?: AudioWorkletNode;
  private destination?: MediaStreamAudioDestinationNode;

  /**
   * 输出轨意外结束时通知源绑定；主动释放前移除监听。
   */
  private onEnded?: () => void;

  /**
   * 固定输入格式、时间连续性及发布状态
   */
  private format?: string;
  private nextInputTime?: number;
  private published = false;

  /**
   * 有界在途包预算；epoch 使清空前的端口反馈失效
   */
  private sequence = 0;
  private epoch = 0;
  private pendingSeconds = 0;
  private readonly pending = new Map<number, number>();

  /**
   * 音频采样时钟，单位为微秒，用于和视频共用源时间映射。
   */
  get nowUs(): number {
    return (this.context?.currentTime ?? 0) * 1_000_000;
  }

  /**
   * 由 SDK 拥有的 RTC 输入轨。
   */
  get track(): MediaStreamTrack | undefined {
    return this.destination?.stream.getAudioTracks()[0];
  }

  /**
   * 从用户手势准备音频图；加载或自动播放策略失败时拒绝并释放资源。
   */
  async prepare(signal: AbortSignal, onError: (error: XmaxError) => void): Promise<void> {
    if (typeof AudioContext === "undefined" || typeof AudioWorkletNode === "undefined") {
      throw new XmaxError(XmaxErrorCode.mediaError, "External PCM input requires AudioWorklet support");
    }
    const context = new AudioContext({ sampleRate: 48000 });
    this.context = context;
    let url: string | undefined;
    try {
      if (!context.audioWorklet) {
        throw new XmaxError(XmaxErrorCode.mediaError, "External PCM input requires a secure context with AudioWorklet");
      }
      url = URL.createObjectURL(new Blob([EXTERNAL_AUDIO_WORKLET], { type: "text/javascript" }));
      await waitForMediaOperation(Promise.all([context.resume(), context.audioWorklet.addModule(url)]), signal, 3000,
        "External audio initialization; start from a user gesture");
      if (context.state !== "running") {
        throw new XmaxError(XmaxErrorCode.mediaError, "External audio must be initialized from a user gesture");
      }

      const destination = new MediaStreamAudioDestinationNode(context, { channelCount: 1, channelCountMode: "explicit" });
      this.destination = destination;
      const processor = new AudioWorkletNode(context, "xmax-external-audio", {
        numberOfInputs: 0, numberOfOutputs: 1, outputChannelCount: [1],
      });
      this.processor = processor;
      processor.port.onmessage = ({ data }) => {
        if (this.processor !== processor || data?.epoch !== this.epoch) {
          return;
        }
        this.pendingSeconds = Math.max(0, this.pendingSeconds - (this.pending.get(data.id) ?? 0));
        this.pending.delete(data.id);
      };
      processor.onprocessorerror = () => onError(new XmaxError(XmaxErrorCode.mediaError, "External audio processor failed"));
      processor.connect(destination);
      if (!this.track || this.track.readyState !== "live") {
        throw new XmaxError(XmaxErrorCode.mediaError, "External audio did not produce a live track");
      }
      this.onEnded = () => onError(new XmaxError(XmaxErrorCode.mediaError, "External audio output ended"));
      this.track.addEventListener("ended", this.onEnded);
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
   * 只在实际发布期间消费输入；切换状态立即丢弃旧音频，不为重连积压。
   */
  setPublished(published: boolean): void {
    if (this.published === published) {
      return;
    }
    this.published = published;
    this.reset();
  }

  /**
   * 清空线程队列和在途预算，不改变输入格式或发布状态。
   */
  reset(): void {
    this.pending.clear();
    this.pendingSeconds = 0;
    this.processor?.port.postMessage({ type: "reset", epoch: ++this.epoch });
  }

  /**
   * 同步复制 PCM、混声道并交给采样线程；无效时间或重叠包忽略，格式变化抛错。
   */
  push(frame: RealtimeExternalAudioFrame, mapTime: (timestamp: number) => number): void {
    const timestamp = frame.timestamp;
    if (!Number.isSafeInteger(timestamp) || timestamp < 0) {
      return;
    }
    const { sampleRate: rate, numberOfChannels: channels, numberOfFrames: frames, format } = frame;
    if (!format || !Number.isInteger(rate) || rate < 8000 || rate > 192000 ||
      !Number.isInteger(channels) || channels < 1 || channels > 8 || !Number.isInteger(frames) || frames < 1 || frames > rate) {
      throw new XmaxError(XmaxErrorCode.mediaError, "External audio requires live PCM at 8–192 kHz, 1–8 channels, at most one second per packet");
    }
    const identity = `${format}/${rate}/${channels}`;
    if (this.format && this.format !== identity) {
      throw new XmaxError(XmaxErrorCode.mediaError, "External audio format must remain unchanged during a source binding");
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
      throw new XmaxError(XmaxErrorCode.mediaError, "External audio context is suspended");
    }
    const time = mapTime(timestamp);
    if (time + seconds * 1_000_000 <= this.nowUs) {
      return;
    }
    if (time > this.nowUs + 2_000_000 || this.pendingSeconds + seconds > 2 || this.pending.size >= 256) {
      throw new XmaxError(XmaxErrorCode.mediaError, "External audio must be paced in real time; pending audio exceeds two seconds or 256 packets");
    }

    const samples = new Float32Array(frames);
    const plane = new Float32Array(frames);
    for (let channel = 0; channel < channels; channel++) {
      frame.copyTo(plane, { planeIndex: channel, format: "f32-planar" });
      for (let i = 0; i < frames; i++) {
        const value = Number.isFinite(plane[i]) ? plane[i]! : 0;
        samples[i]! += Math.max(-1, Math.min(1, value)) / channels;
      }
    }
    const id = ++this.sequence;
    const start = Math.round(time * context.sampleRate / 1_000_000);
    this.pending.set(id, seconds);
    this.pendingSeconds += seconds;
    processor.port.postMessage({ type: "packet", id, epoch: this.epoch, samples, rate,
      start, end: start + Math.round(seconds * context.sampleRate) }, [samples.buffer]);
  }

  /**
   * 停止 SDK 音轨、处理器和上下文；不触碰接入方原始音频资源。
   */
  async close(): Promise<void> {
    this.published = false;
    const context = this.context;
    this.context = undefined;
    if (this.onEnded) {
      this.track?.removeEventListener("ended", this.onEnded);
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
      await waitForMediaOperation(context.close(), new AbortController().signal, 2000, "External audio close");
    }
  }
}
