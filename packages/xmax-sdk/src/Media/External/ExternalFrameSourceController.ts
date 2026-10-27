//
//  ExternalFrameSourceController.ts
//  XmaxSDK
//
//  Author: 翁跃庭 (Yueting Weng)
//  GitHub: https://github.com/Xmax-AI/XmaxSDK-Web
//
//  Copyright (c) 2026 XMAX.AI PTE. LTD.
//

import { XmaxError, XmaxErrorCode } from "../../Foundation/Errors/XmaxError";
import { XmaxLogger } from "../../Foundation/Logging/XmaxLogger";
import { ExternalAudioFrameSource } from "../../Foundation/Media/Audio/ExternalAudioFrameSource";
import { waitForMediaOperation } from "../../Foundation/Media/MediaOperation";
import type { MediaServicing } from "../../Service/Media/MediaServicing";
import { RealtimeMediaStream } from "../../Service/Realtime/RealtimeMediaStream";
import { RealtimeVideoTrack } from "../../Service/Realtime/RealtimeVideoTrack";
import { StreamID } from "../../Service/Realtime/StreamID";
import { VideoRenderRegistry, type VideoRenderTarget } from "../../Service/Realtime/VideoRenderBinding";
import { ExternalFrameSink } from "./ExternalFrameSink";
import type { RealtimeExternalVideoSource } from "./RealtimeExternalVideoSource";

/**
 * 一次外部源绑定及 SDK 创建的媒体资源。
 */
interface ExternalBinding {

  /**
   * 接入方源与生命周期取消。
   */
  source: RealtimeExternalVideoSource;
  abort: AbortController;

  /**
   * SDK 拥有的视频输出、可选音频和输入端。
   */
  canvas: HTMLCanvasElement;
  stream: MediaStream;
  track: RealtimeVideoTrack;
  audio?: ExternalAudioFrameSource;
  sink?: ExternalFrameSink;

  /**
   * 预览目标和轨道结束通知。
   */
  targets: Set<VideoRenderTarget>;
  onEnded?: () => void;
}

/**
 * 外部帧源的绑定、预览与释放；不拥有接入方采集设备和输入帧。
 */
export class ExternalFrameSourceController {

  /**
   * 包含仍在准备的源，防止并发覆盖。
   */
  private binding?: ExternalBinding;

  /**
   * 注入不可恢复错误的生命周期通知。
   */
  constructor(private readonly onError: (error: XmaxError) => void) {}

  /**
   * 是否持有准备中或已绑定的源。
   */
  get isActive(): boolean {
    return this.binding !== undefined;
  }

  /**
   * 可预览、发布的视频轨。
   */
  get currentTrack(): RealtimeVideoTrack | undefined {
    return this.binding?.track;
  }

  /**
   * 源声明音频时创建的可发布音轨。
   */
  get audioTrack(): MediaStreamTrack | undefined {
    return this.binding?.audio?.track;
  }

  /**
   * 准备媒体输出后调用 source.start；不等待首帧，失败或取消时调用 stop 解绑。
   */
  async create(source: RealtimeExternalVideoSource, media: MediaServicing, signal: AbortSignal): Promise<RealtimeMediaStream> {
    if (this.binding) {
      throw new XmaxError(XmaxErrorCode.invalidConfiguration, "Close the current external frame source first");
    }
    if (!source || typeof source.start !== "function" || typeof source.stop !== "function" ||
      (source.hasAudio !== undefined && typeof source.hasAudio !== "boolean")) {
      throw new XmaxError(XmaxErrorCode.invalidConfiguration, "A valid external video source is required");
    }
    source.videoFormat.validate();
    const size = media.resolveMediaSize(source.videoFormat, "external");
    const sourceFormat = source.videoFormat.resized(source.videoFormat.width, source.videoFormat.height);
    const format = sourceFormat.resized(size.width, size.height);
    if (signal.aborted) {
      throw new XmaxError(XmaxErrorCode.cancelled, "External source creation cancelled");
    }
    if (typeof document === "undefined" || typeof VideoFrame === "undefined") {
      throw new XmaxError(XmaxErrorCode.mediaError, "External frames require a browser with VideoFrame support");
    }
    const canvas = document.createElement("canvas");
    canvas.width = size.width;
    canvas.height = size.height;
    const context = canvas.getContext("2d", { alpha: false });
    if (!context || typeof canvas.captureStream !== "function") {
      throw new XmaxError(XmaxErrorCode.mediaError, "Canvas video capture is unavailable");
    }
    const stream = canvas.captureStream(format.fps);
    const native = stream.getVideoTracks()[0] as CanvasCaptureMediaStreamTrack | undefined;
    if (!native || native.readyState !== "live") {
      stream.getTracks().forEach(track => track.stop());
      throw new XmaxError(XmaxErrorCode.mediaError, "Canvas did not provide a live external video track");
    }
    const track = new RealtimeVideoTrack({ id: "external-frames", videoFormat: format });
    track.mediaStreamTrack = native;
    const binding: ExternalBinding = { source, canvas, stream, track, abort: new AbortController(), targets: new Set() };
    this.binding = binding;
    const abort = () => binding.abort.abort();
    signal.addEventListener("abort", abort, { once: true });
    if (signal.aborted) {
      abort();
    }
    try {
      if (source.hasAudio) {
        binding.audio = new ExternalAudioFrameSource();
        await binding.audio.prepare(binding.abort.signal, error => {
          if (binding.sink) {
            binding.sink.reportError(error);
          } else {
            binding.abort.abort();
            if (this.binding === binding) {
              this.onError(error);
            }
          }
        });
      }
      const sink = new ExternalFrameSink(format, sourceFormat, context, native, binding.audio, error => {
        if (this.binding === binding) {
          this.onError(error);
        }
      });
      binding.sink = sink;
      binding.onEnded = () => sink.reportError(new XmaxError(XmaxErrorCode.mediaError, "External video output ended"));
      native.addEventListener("ended", binding.onEnded);
      VideoRenderRegistry.register(track, {
        attachHandler: view => {
          if (this.binding !== binding) {
            return;
          }
          view.isMirrored = false;
          view.setMediaStream(stream);
          binding.targets.add(view);
        },
        detachHandler: view => {
          binding.targets.delete(view);
          view.setMediaStream(null);
        },
      });
      await waitForMediaOperation(Promise.resolve(source.start(sink)), binding.abort.signal, 10_000, "External source startup");
      if (this.binding !== binding || binding.abort.signal.aborted || !sink.isRequestingFrames) {
        throw new XmaxError(XmaxErrorCode.cancelled, "External source is no longer attached");
      }
      return new RealtimeMediaStream({ id: StreamID.local, videoTrack: track });
    } catch (error) {
      if (this.binding === binding) {
        await this.stop();
      }
      throw XmaxError.from(error);
    } finally {
      signal.removeEventListener("abort", abort);
    }
  }

  /**
   * 跟随 RTC 实际发布状态，不发布时丢弃音频。
   */
  setAudioPublished(published: boolean): void {
    this.binding?.audio?.setPublished(published && this.binding.sink?.isRequestingFrames === true);
  }

  /**
   * 释放连接或本地媒体前同步拒绝后续帧。
   */
  invalidate(): void {
    this.binding?.sink?.invalidate();
    this.binding?.abort.abort();
  }

  /**
   * 先使 sink 失效并释放 SDK 输出，再有界等待接入方停止回调。
   */
  async stop(): Promise<void> {
    const binding = this.binding;
    if (!binding) {
      return;
    }
    this.binding = undefined;
    binding.abort.abort();
    binding.sink?.invalidate();
    const native = binding.track.mediaStreamTrack;
    if (binding.onEnded) {
      native?.removeEventListener("ended", binding.onEnded);
    }
    VideoRenderRegistry.unregister(binding.track);
    binding.track.mediaStreamTrack = undefined;
    for (const view of binding.targets) {
      try {
        view.setMediaStream(null);
      } catch {
        // 单个视图失败不阻断其他预览和媒体资源清理。
      }
    }
    binding.targets.clear();
    binding.stream.getTracks().forEach(track => track.stop());
    binding.canvas.width = 0;
    binding.canvas.height = 0;
    const results = await Promise.allSettled([
      binding.audio?.close(),
      waitForMediaOperation(Promise.resolve().then(() => binding.source.stop()), new AbortController().signal, 2000, "External source stop"),
    ]);
    for (const result of results) {
      if (result.status === "rejected") {
        XmaxLogger.media.warning(() => `External source cleanup failed: ${XmaxError.from(result.reason).message}`);
      }
    }
  }
}
