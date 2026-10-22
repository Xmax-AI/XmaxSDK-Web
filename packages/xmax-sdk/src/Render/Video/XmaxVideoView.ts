//
//  XmaxVideoView.ts
//  XmaxSDK
//
//  Author: 翁跃庭 (Yueting Weng)
//  GitHub: https://github.com/Xmax-AI/XmaxSDK-Web
//
//  Copyright (c) 2026 XMAX.AI PTE. LTD.
//

import { VideoContentMode } from "../../Foundation/Media/Video/VideoContentMode";
import { XmaxLogger } from "../../Foundation/Logging/XmaxLogger";
import type { VideoRenderStatistics } from "./VideoRenderStatistics";
import { RenderStatisticsController } from "./RenderStatisticsController";
import { RenderWarmupController } from "./RenderWarmupController";
import type { RealtimeVideoTrack } from "../../Service/Realtime/RealtimeVideoTrack";
import { VideoRenderRegistry } from "../../Service/Realtime/VideoRenderBinding";
import { RemoteVideoFramePipeline, type RemoteFrameInterpolationOptions } from "./RemoteVideoFramePipeline";
import { TrajectoryRegistry } from "../Trajectory/TrajectoryRegistry";
import { TrajectoryOverlayView } from "../Trajectory/TrajectoryOverlayView";
import { DefaultTrajectoryEffectRenderer } from "../Trajectory/DefaultTrajectoryEffectRenderer";
import type { TrajectoryEffectRendering } from "../Trajectory/TrajectoryEffectRendering";

/**
 * SDK 视频显示模式与浏览器缩放样式的对应关系。
 */
const OBJECT_FIT: Record<VideoContentMode, "contain" | "cover"> = {
  [VideoContentMode.fit]: "contain",
  [VideoContentMode.fill]: "cover",
};

/**
 * 单轨视频视图（框架无关）。
 *
 * 通过 `attach(to:)` 挂载到任意容器元素；设置 `track` 后自动渲染。
 * 轨道注册了渲染绑定时走绑定管线，否则按 `mediaStreamTrack` 直接渲染。
 * SDK 远端轨道在首帧后预热 1000 ms，再用 300 ms 渐入；本地预览不延迟。
 */
export class XmaxVideoView {

  /**
   * 视图根元素（div，内含一个 video 元素）。
   */
  readonly element: HTMLDivElement;

  /**
   * @internal 渲染视频帧的元素，供绑定管线使用。
   */
  readonly videoElement: HTMLVideoElement;

  /**
   * 视频与插帧画布共用的显示层，与触控轨迹层独立。
   */
  private readonly videoLayer: HTMLDivElement;

  /**
   * 首帧预热只影响媒体内容，不影响轨迹交互层。
   */
  private readonly warmupLayer: HTMLDivElement;

  /**
   * 视频画面是否可见。
   */
  private videoVisible = true;

  /**
   * 首帧实际提交显示时调用（一次性；换轨后重新武装）。
   */
  frameDisplayHandler?: () => void;

  /**
   * 渲染状态
   */
  private currentTrack?: RealtimeVideoTrack;

  /**
   * 画面在视口中的缩放与裁剪方式。
   */
  private contentMode: VideoContentMode;

  /**
   * 是否对显示画面应用水平镜像。
   */
  private mirrored = false;

  /**
   * 首帧显示通知与异步回调版本
   */
  private hasNotifiedFrameDisplay = false;

  /**
   * 视频开始播放时尝试通知首帧就绪。
   */
  private onPlaying?: () => void;

  /**
   * 首帧观察回调的取消句柄。
   */
  private videoFrameCallbackID?: number;

  /**
   * 首帧通知版本，避免旧流回调影响新流。
   */
  private frameNotificationSequence = 0;

  /**
   * 远端插帧配置与渲染资源
   */
  private interpolationOptions?: RemoteFrameInterpolationOptions;

  /**
   * 当前远端视频的插帧处理与显示管线。
   */
  private interpolationPipeline?: RemoteVideoFramePipeline;

  /**
   * 呈现插帧结果的画布。
   */
  private interpolationCanvas?: HTMLCanvasElement;

  /**
   * 呈现统计组件
   */
  private readonly statisticsController: RenderStatisticsController;

  /**
   * 远端画面预热与渐入组件
   */
  private readonly warmupController: RenderWarmupController;

  /**
   * DOM 挂载状态
   */
  private detached = false;

  /**
   * 轨迹交互配置与懒加载视图
   */
  private interactionEnabled = true;

  /**
   * 接入方提供的轨迹视觉效果实现。
   */
  private customTrajectoryRenderer?: TrajectoryEffectRendering;

  /**
   * 视口触点采样与轨迹效果覆盖层。
   */
  private trajectoryOverlay?: TrajectoryOverlayView;

  /**
   * 创建单轨视频视图。
   *
   * @param options.videoContentMode 视频内容显示模式，默认 fill。
   */
  constructor(
    options?: {
      videoContentMode?: VideoContentMode;
      isInteractionEnabled?: boolean
    }
  ) {
    this.contentMode = options?.videoContentMode ?? VideoContentMode.fill;
    this.interactionEnabled = options?.isInteractionEnabled ?? true;

    this.element = document.createElement("div");
    this.element.style.position = "relative";
    this.element.style.overflow = "hidden";
    this.element.style.backgroundColor = "black";

    this.videoLayer = document.createElement("div");
    Object.assign(this.videoLayer.style, {
      position: "absolute", inset: "0", pointerEvents: "none", opacity: "1",
    });
    this.element.appendChild(this.videoLayer);

    this.warmupLayer = document.createElement("div");
    Object.assign(this.warmupLayer.style, { position: "absolute", inset: "0" });
    this.videoLayer.appendChild(this.warmupLayer);
    this.warmupController = new RenderWarmupController(this.warmupLayer);

    this.videoElement = document.createElement("video");
    this.statisticsController = new RenderStatisticsController(this.videoElement);
    this.videoElement.autoplay = true;
    this.videoElement.playsInline = true;
    this.videoElement.muted = true;

    this.videoElement.style.position = "absolute";
    this.videoElement.style.inset = "0";
    this.videoElement.style.width = "100%";
    this.videoElement.style.height = "100%";

    this.applyContentMode();

    this.warmupLayer.appendChild(this.videoElement);
  }

  /**
   * 是否显示视频画面，默认 true；隐藏时保留播放、解码和触控轨迹。
   */
  get isVideoVisible(): boolean {
    return this.videoVisible;
  }

  /**
   * 即时切换视频和插帧画布的显隐，不改变触控配置或媒体流。
   */
  set isVideoVisible(
    visible: boolean
  ) {
    if (this.videoVisible === visible) {
      return;
    }
    this.videoVisible = visible;
    this.videoLayer.style.opacity = visible ? "1" : "0";
  }

  /**
   * 是否允许远端轨迹交互；本地轨道没有交互绑定，不受此开关影响。
   */
  get isInteractionEnabled(): boolean {
    return this.interactionEnabled;
  }

  /**
   * 关闭时立即取消当前手势，不影响视频播放。
   */
  set isInteractionEnabled(
    enabled: boolean
  ) {
    this.interactionEnabled = enabled;
    this.trajectoryOverlay?.configure(this.contentMode, this.mirrored, enabled);
  }

  /**
   * 自定义轨迹视觉效果；undefined 表示使用 SDK 默认效果。
   */
  get trajectoryRenderer(): TrajectoryEffectRendering | undefined {
    return this.customTrajectoryRenderer;
  }

  /**
   * 替换效果前释放旧动画，采样及网络发送仍由 SDK 管理。
   */
  set trajectoryRenderer(
    renderer: TrajectoryEffectRendering | undefined
  ) {
    if (this.customTrajectoryRenderer === renderer) {
      return;
    }
    this.disposeTrajectory();
    this.customTrajectoryRenderer = renderer;
    this.attachTrajectory();
  }

  /**
   * 当前显示的视频轨道；切换时自动解绑旧轨道。
   */
  get track(): RealtimeVideoTrack | undefined {
    return this.currentTrack;
  }

  /**
   * 每秒接收当前视图的呈现统计；换流、卸载或不可统计时返回 undefined。
   */
  get renderStatisticsHandler(): ((
    statistics?: VideoRenderStatistics
  ) => void) | undefined {
    return this.statisticsController.handler;
  }

  /**
   * 更新统计回调，不影响播放；移除回调时停止采集。
   */
  set renderStatisticsHandler(
    handler: ((
      statistics?: VideoRenderStatistics
    ) => void) | undefined
  ) {
    this.statisticsController.handler = handler;
    this.statisticsController.stop();
    this.startRenderStatistics();
  }

  /**
   * 解绑旧轨道后接入新轨道，并为新内容重新启用一次性首帧通知。
   */
  set track(
    track: RealtimeVideoTrack | undefined
  ) {
    if (this.currentTrack === track) {
      return;
    }
    this.detachCurrentTrack();
    this.currentTrack = track;
    this.hasNotifiedFrameDisplay = false;
    if (track) {
      this.attachTrack(track);
    }
  }

  /**
   * 视频内容在容器中的显示模式。
   */
  get videoContentMode(): VideoContentMode {
    return this.contentMode;
  }

  /**
   * 更新视频及插帧画布的内容缩放方式；相同配置不重复应用。
   */
  set videoContentMode(
    mode: VideoContentMode
  ) {
    if (this.contentMode === mode) {
      return;
    }
    this.contentMode = mode;
    this.applyContentMode();
  }

  /**
   * 本地预览是否镜像显示（仅影响显示，不影响发布流）。
   */
  get isMirrored(): boolean {
    return this.mirrored;
  }

  /**
   * 更新视图镜像变换，仅改变呈现方式，不改动媒体流。
   */
  set isMirrored(
    mirrored: boolean
  ) {
    if (this.mirrored === mirrored) {
      return;
    }
    this.mirrored = mirrored;
    this.applyContentMode();
  }

  /**
   * 挂载到容器元素。
   */
  attach(
    to: HTMLElement
  ): void {
    this.detached = false;
    to.appendChild(this.element);
    this.attachTrajectory();

    // 浏览器可能在移出 DOM 时暂停 MediaStream video；重新挂载要恢复解码回调。
    if (this.videoElement.srcObject && this.videoElement.autoplay && !this.videoElement.ended && this.videoElement.paused && typeof this.videoElement.play === "function") {
      void this.videoElement.play().catch((error) => {
        XmaxLogger.render.warning(() => `恢复视频播放失败 (Failed to Resume Video Playback)\n└─ ${String(error)}`);
      });
    }

    this.startInterpolation();
    this.startRenderStatistics();
    if (this.videoElement.srcObject && !this.hasNotifiedFrameDisplay) {
      this.prepareRenderWarmup();
      this.armFrameDisplayNotification();
    }
  }

  /**
   * 从容器元素移除。
   */
  detach(): void {
    this.detached = true;
    this.disposeTrajectory();
    this.statisticsController.stop();
    this.stopInterpolation();
    this.cancelFrameDisplayNotification();
    this.warmupController.reset();
    this.hasNotifiedFrameDisplay = false;
    this.element.remove();
  }

  /**
   * 直接设置渲染用的媒体流（绑定管线和直接渲染共用）。 @internal
   */
  setMediaStream(
    stream: MediaStream | null
  ): void {
    if (this.videoElement.srcObject === stream) {
      return;
    }

    this.statisticsController.stop();
    this.stopInterpolation();
    this.cancelFrameDisplayNotification();
    this.hasNotifiedFrameDisplay = false;

    this.videoElement.srcObject = stream;
    this.warmupController.reset();
    if (stream) {
      this.videoElement.autoplay = true;
      this.prepareRenderWarmup();
      this.armFrameDisplayNotification();
      this.startInterpolation();
      this.startRenderStatistics();
    }
  }

  /**
   * 新生成任务重新等待首帧和预热，不替换正在播放的媒体流。 @internal
   */
  prepareForGeneration(): void {
    this.cancelFrameDisplayNotification();
    this.warmupController.reset();
    this.hasNotifiedFrameDisplay = false;
    this.prepareRenderWarmup();
    if (!this.detached && this.videoElement.srcObject) {
      this.armFrameDisplayNotification();
    }
  }

  /**
   * 由远端绑定注入配置；本地预览不走此管线。 @internal
   */
  setFrameInterpolation(
    options?: RemoteFrameInterpolationOptions
  ): void {
    if (options === this.interpolationOptions)
      return;
    this.stopInterpolation();
    this.interpolationOptions = options;
    this.startInterpolation();
  }

  /**
   * 视图已挂载且媒体与配置就绪时创建插帧画布和管线，避免重复启动。
   */
  private startInterpolation(): void {
    if (this.detached || this.interpolationPipeline || !this.interpolationOptions || !this.videoElement.srcObject)
      return;

    const canvas = document.createElement("canvas");
    Object.assign(canvas.style, {
      position: "absolute", inset: "0", width: "100%", height: "100%",
      pointerEvents: "none", visibility: "hidden", backgroundColor: "black",
    });
    this.interpolationCanvas = canvas;
    this.applyContentMode();
    this.warmupLayer.appendChild(canvas);

    const options = this.interpolationOptions;
    const pipeline = new RemoteVideoFramePipeline(this.videoElement, canvas, {
      ...options,
      onActiveChange: (active) => {
        this.statisticsController.setInterpolationActive(active);
        options.onActiveChange?.(active);
      },
      onFramePresented: (interpolated) => {
        this.statisticsController.recordCanvasFrame(interpolated);
        options.onFramePresented?.(interpolated);
      },
    });
    this.interpolationPipeline = pipeline;
    pipeline.start();
  }

  /**
   * 停止并释放插帧管线，移除辅助画布，保留原始视频元素。
   */
  private stopInterpolation(): void {
    const pipeline = this.interpolationPipeline;
    this.interpolationPipeline = undefined;
    pipeline?.stop();
    this.interpolationCanvas?.remove();
    this.interpolationCanvas = undefined;
  }

  /**
   * 接入轨道画面：优先走注册的渲染绑定，否则按媒体轨直接渲染。
   */
  private attachTrack(
    track: RealtimeVideoTrack
  ): void {
    const binding = VideoRenderRegistry.binding(track);
    if (binding) {
      binding.attachHandler(this, this.contentMode);
      this.attachTrajectory();
      return;
    }

    if (track.mediaStreamTrack) {
      this.setMediaStream(new MediaStream([track.mediaStreamTrack]));
      return;
    }

    XmaxLogger.render.warning(
      () => `轨道 ${track.id} 既没有渲染绑定也没有媒体轨，无法显示`,
    );
  }

  /**
   * 解绑当前轨道并清空渲染内容。
   */
  private detachCurrentTrack(): void {
    this.warmupController.reset();
    this.disposeTrajectory();
    this.statisticsController.stop();
    const track = this.currentTrack;
    if (track) {
      VideoRenderRegistry.binding(track)?.detachHandler(this);
    }
    this.setFrameInterpolation(undefined);
    this.cancelFrameDisplayNotification();
    this.videoElement.srcObject = null;
  }

  /**
   * 首帧提交合成器时通知；旧浏览器回退到 playing 近似判断。
   */
  private armFrameDisplayNotification(): void {
    this.cancelFrameDisplayNotification();

    const sequence = this.frameNotificationSequence;
    const track = this.currentTrack;
    const binding = track ? VideoRenderRegistry.binding(track) : undefined;

    const notify = () => {
      if (sequence !== this.frameNotificationSequence || this.hasNotifiedFrameDisplay) {
        return;
      }
      this.hasNotifiedFrameDisplay = true;
      this.cancelFrameDisplayNotification();
      const notifiedSequence = this.frameNotificationSequence;
      binding?.frameDisplayHandler?.();
      this.frameDisplayHandler?.();
      if (notifiedSequence === this.frameNotificationSequence) {
        this.warmupController.start(() => {
          this.applyContentMode();
          binding?.renderWarmupCompletedHandler?.();
        });
      }
    };

    if (typeof this.videoElement.requestVideoFrameCallback === "function") {
      this.videoFrameCallbackID = this.videoElement.requestVideoFrameCallback(notify);
      return;
    }

    this.onPlaying = notify;
    this.videoElement.addEventListener("playing", this.onPlaying, {
      once: true,
    });
    if (!this.videoElement.paused && this.videoElement.readyState >= 2) {
      queueMicrotask(notify);
    }
  }

  /**
   * 换流、解绑或卸载时取消观察，防止迟到的首帧归入下一条流。
   */
  private cancelFrameDisplayNotification(): void {
    this.frameNotificationSequence += 1;
    if (this.videoFrameCallbackID !== undefined) {
      this.videoElement.cancelVideoFrameCallback(this.videoFrameCallbackID);
      this.videoFrameCallbackID = undefined;
    }
    if (this.onPlaying) {
      this.videoElement.removeEventListener("playing", this.onPlaying);
      this.onPlaying = undefined;
    }
  }

  /**
   * 仅远端渲染绑定启用预热，本地预览和普通媒体直接显示。
   */
  private prepareRenderWarmup(): void {
    const binding = this.currentTrack ? VideoRenderRegistry.binding(this.currentTrack) : undefined;
    this.warmupController.prepare(binding?.renderWarmupMs);
    this.applyContentMode();
  }

  /**
   * 应用显示模式与镜像样式。
   */
  private applyContentMode(): void {
    this.trajectoryOverlay?.configure(this.contentMode, this.mirrored, this.interactionEnabled);
    this.videoElement.style.objectFit = OBJECT_FIT[this.contentMode];
    this.videoElement.style.transform = this.mirrored ? "scaleX(-1)" : "";
    if (this.interpolationCanvas) {
      this.interpolationCanvas.style.objectFit = OBJECT_FIT[this.contentMode];
      this.interpolationCanvas.style.transform = this.mirrored ? "scaleX(-1)" : "";
    }
  }

  /**
   * 视图未卸载时启动呈现统计，采样及媒体就绪检查由统计组件负责。
   */
  private startRenderStatistics(): void {
    if (!this.detached)
      this.statisticsController.start();
  }

  /**
   * 仅为具备交互能力的轨道创建覆盖层，普通视频和本地预览不分配 Canvas。
   */
  private attachTrajectory(): void {
    if (this.detached || this.trajectoryOverlay || !this.currentTrack) {
      return;
    }
    const binding = TrajectoryRegistry.binding(this.currentTrack);
    if (!binding) {
      return;
    }
    const overlay = new TrajectoryOverlayView(this.customTrajectoryRenderer ?? new DefaultTrajectoryEffectRenderer());
    this.trajectoryOverlay = overlay;
    overlay.configure(this.contentMode, this.mirrored, this.interactionEnabled);
    this.element.appendChild(overlay.element);
    binding.attach(overlay);
  }

  /**
   * 换轨或卸载时移除全部交互资源；再次挂载时重新建立绑定。
   */
  private disposeTrajectory(): void {
    this.trajectoryOverlay?.dispose();
    this.trajectoryOverlay = undefined;
  }
}
