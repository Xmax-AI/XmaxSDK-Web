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
 * 编排原始远端音视频观察与有界交付，不持有录制器、文件或时长限制。
 */
export class RemoteMediaFrameController {

  /**
   * 监听器与准备操作
   */
  private listener?: RealtimeMediaFrameListener;

  /**
   * 取消尚未完成的音频初始化。
   */
  private setup?: AbortController;

  /**
   * 已准备的音频线程。
   */
  private audio?: RemoteAudioFrameSource;

  /**
   * 原始视频观察器与交付队列
   */
  private readonly video = new RemoteVideoFrameSource();

  /**
   * 限制尚未交付的媒体占用。
   */
  private readonly dispatcher = new RealtimeMediaFrameDispatcher();

  /**
   * RTC 当前结果流与已经安装的绑定。
   */
  private source?: RemoteMediaTracks;

  /**
   * 当前取帧绑定。
   */
  private bound?: RemoteMediaTracks;

  /**
   * 同一结果流的音视频共享标识。
   */
  private streamID?: string;

  /**
   * 同一绑定只报告一次运行期取帧错误。
   */
  private reportedError = false;

  /**
   * 替换或取消观察；准备失败仅拒绝本次设置，不终止实时生成。
   */
  async setListener(listener?: RealtimeMediaFrameListener): Promise<void> {
    this.setup?.abort();
    const setup = new AbortController();
    this.setup = setup;
    this.listener = undefined;
    this.stopBinding();
    this.dispatcher.setListener(undefined);
    const previous = this.audio;
    this.audio = undefined;
    await previous?.close();
    if (setup.signal.aborted) throw new XmaxError(XmaxErrorCode.cancelled, "Remote media listener replaced");
    if (!listener) return;

    if (typeof VideoFrame === "undefined" || typeof HTMLVideoElement === "undefined" ||
      typeof HTMLVideoElement.prototype.requestVideoFrameCallback !== "function") {
      throw new XmaxError(XmaxErrorCode.mediaError, "This browser cannot provide remote video frames");
    }
    const audio = new RemoteAudioFrameSource();
    this.audio = audio;
    try {
      await audio.prepare(setup.signal);
      if (setup.signal.aborted) throw new XmaxError(XmaxErrorCode.cancelled, "Remote media listener replaced");
      this.listener = listener;
      this.dispatcher.setListener(listener);
      this.bind(true);
    } catch (error) {
      if (this.audio === audio) this.audio = undefined;
      await audio.close();
      throw error;
    }
  }

  /**
   * 结果流、任务或原始音轨变化时更新取帧；未设置监听器时只记录绑定，不分配资源。
   */
  setSource(source?: RemoteMediaTracks): void {
    this.source = source;
    if (!this.listener || !this.audio) return;
    this.bind();
  }

  /**
   * 安装当前结果流；只换音轨时保持视频和共享标识。
   */
  private bind(strict = false): void {
    const source = this.source;
    const previous = this.bound;
    if (!source) {
      this.stopBinding();
      return;
    }
    const sameStream = previous?.bindingID === source.bindingID && previous.userID === source.userID &&
      previous.videoTrack === source.videoTrack;
    if (sameStream && previous.audioTrack === source.audioTrack) return;
    if (!sameStream) {
      this.stopBinding();
      this.streamID = crypto.randomUUID();
      this.reportedError = false;
    }
    this.bound = source;
    const streamID = this.streamID!;
    try {
      if (!sameStream) {
        this.video.start(source.videoTrack, packet => {
          if (this.streamID !== streamID) { packet.frame.close(); return; }
          const frame = Object.freeze({ frame: packet.frame, presentationTimeStamp: packet.frame.timestamp,
            duration: packet.frame.duration ?? undefined });
          this.dispatcher.dispatch({ streamID, isDiscontinuous: packet.discontinuous,
            content: { type: "video", frame }, presentationTimeStamp: frame.presentationTimeStamp, duration: frame.duration });
        }, error => this.report(error));
      }
      this.audio!.setTrack(source.audioTrack, packet => {
        if (this.streamID !== streamID) return;
        const frame = Object.freeze({ data: packet.data, sampleRate: packet.sampleRate, channels: packet.channels,
          samplesPerChannel: packet.samplesPerChannel, presentationTimeStamp: packet.presentationTimeStamp,
          duration: packet.samplesPerChannel * 1_000_000 / packet.sampleRate });
        this.dispatcher.dispatch({ streamID, isDiscontinuous: packet.discontinuous,
          content: { type: "audio", frame }, presentationTimeStamp: frame.presentationTimeStamp, duration: frame.duration });
      });
    } catch (error) {
      this.stopBinding();
      if (strict) throw error;
      this.report(error);
    }
  }

  /**
   * 停止旧绑定和待交付帧，借用的 RTC 轨道保持原状。
   */
  private stopBinding(): void {
    this.streamID = undefined;
    this.bound = undefined;
    this.video.stop();
    this.audio?.setTrack(undefined, () => {});
    this.dispatcher.reset();
  }

  /**
   * 运行期观察失败不终止媒体播放或生成；记录明确的诊断原因。
   */
  private report(error: unknown): void {
    if (this.reportedError) return;
    this.reportedError = true;
    XmaxLogger.render.warning(() => `Remote media frame observation failed: ${XmaxError.from(error).message}`);
  }
}
