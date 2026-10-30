//
//  XmaxRealtimeVideoView.ts
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
import { VideoRenderRegistry } from "./VideoRenderRegistry";
import { TrajectoryRegistry } from "../Trajectory/TrajectoryRegistry";
import { TrajectoryOverlayView } from "../Trajectory/TrajectoryOverlayView";
import { DefaultTrajectoryEffectRenderer } from "../Trajectory/DefaultTrajectoryEffectRenderer";
import type { TrajectoryEffectRendering } from "../Trajectory/TrajectoryEffectRendering";
import { AgoraBeautyController, resolvedBeautyOptions } from "../Beauty/AgoraBeautyController";
import type { VideoBeautyOptions } from "../Beauty/VideoBeautyOptions";
import { XmaxError } from "../../Foundation/Errors/XmaxError";

/**
 * The mapping from SDK layout modes to browser object-fit values.
 */
const OBJECT_FIT: Record<VideoContentMode, "contain" | "cover"> = {
  [VideoContentMode.fit]: "contain",
  [VideoContentMode.fill]: "cover",
};

/**
 * A framework-independent view for one local or remote video track.
 *
 * Attach to a container and set track to render. Registered bindings supply custom rendering; other
 * tracks render directly through mediaStreamTrack. SDK remote tracks warm up and fade in according to
 * their binding and view settings; local preview is immediate.
 */
export class XmaxRealtimeVideoView {

  /**
   * The root element containing the video player.
   */
  readonly element: HTMLDivElement;

  /**
   * The player element used by rendering bindings.
   *
   * @internal
   */
  readonly videoElement: HTMLVideoElement;

  /**
   * The video-presentation layer, independent of trajectory interaction.
   */
  private readonly videoLayer: HTMLDivElement;

  /**
   * The media-only warmup layer, which leaves interaction unaffected.
   */
  private readonly warmupLayer: HTMLDivElement;

  /**
   * Whether video content is visible.
   */
  private videoVisible = true;

  /**
   * The one-shot callback after first-frame submission, rearmed when the track changes.
   */
  frameDisplayHandler?: () => void;

  /**
   * The currently rendered track.
   */
  private currentTrack?: RealtimeVideoTrack;

  /**
   * The image scaling and cropping mode.
   */
  private contentMode: VideoContentMode;

  /**
   * Whether video display is mirrored horizontally.
   */
  private mirrored = false;

  /**
   * Whether the current stream has reported its first frame.
   */
  private hasNotifiedFrameDisplay = false;

  /**
   * The fallback playing-event callback for first-frame readiness.
   */
  private onPlaying?: () => void;

  /**
   * The pending first-frame observation handle.
   */
  private videoFrameCallbackID?: number;

  /**
   * The revision preventing old-stream frame callbacks from affecting replacements.
   */
  private frameNotificationSequence = 0;

  /**
   * The presentation-statistics controller.
   */
  private readonly statisticsController: RenderStatisticsController;

  /**
   * The remote warmup and fade-in controller.
   */
  private readonly warmupController: RenderWarmupController;

  /**
   * The unmodified display source, retained while beauty processing supplies a separate output.
   */
  private sourceStream: MediaStream | null = null;

  /**
   * The view's optional beauty strengths; undefined disables processing.
   */
  private storedBeautyOptions?: Readonly<Required<VideoBeautyOptions>>;

  /**
   * The current display-only processor.
   */
  private beautyController?: AgoraBeautyController;

  /**
   * Reports beauty failures after restoring original playback, without changing generation state.
   */
  beautyErrorHandler?: (
    error: XmaxError
  ) => void;

  /**
   * Whether the view has been detached.
   */
  private detached = false;

  /**
   * Whether trajectory interaction is requested.
   */
  private interactionEnabled = true;

  /**
   * The app-supplied trajectory renderer.
   */
  private customTrajectoryRenderer?: TrajectoryEffectRendering;

  /**
   * The viewport sampling and trajectory-effect overlay.
   */
  private trajectoryOverlay?: TrajectoryOverlayView;

  /**
   * Creates a single-track realtime view.
   *
   * @param options.videoContentMode - The layout mode; defaults to fill.
   * @param options.isInteractionEnabled - Whether remote interaction is permitted; defaults to true.
   * @param options.fadeInDurationMs - Fade duration after warmup, in milliseconds; defaults to 300. Zero
   * displays immediately without skipping warmup.
   * @throws An invalidConfiguration error for negative or nonfinite fade durations.
   */
  constructor(
    options?: {
      videoContentMode?: VideoContentMode;
      isInteractionEnabled?: boolean;
      fadeInDurationMs?: number;
    }
  ) {
    this.contentMode = options?.videoContentMode ?? VideoContentMode.fill;
    this.interactionEnabled = options?.isInteractionEnabled ?? true;

    this.element = document.createElement("div");
    this.element.style.position = "relative";
    this.element.style.overflow = "hidden";
    this.element.style.backgroundColor = "black";

    this.videoLayer = document.createElement("div");
    Object.assign(
      this.videoLayer.style,
      {
        position: "absolute",
        inset: "0",
        pointerEvents: "none",
        opacity: "1",
      }
    );
    this.element.appendChild(this.videoLayer);

    this.warmupLayer = document.createElement("div");
    Object.assign(
      this.warmupLayer.style,
      {
        position: "absolute",
        inset: "0"
      }
    );
    this.videoLayer.appendChild(this.warmupLayer);
    this.warmupController = new RenderWarmupController(
      this.warmupLayer,
      options?.fadeInDurationMs
    );

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
   * The fade duration after remote warmup, in milliseconds.
   */
  get fadeInDurationMs(): number {
    return this.warmupController.fadeInDurationMs;
  }

  /**
   * Display-only beauty strengths. Undefined disables processing; dependencies load only when enabled.
   * Original media callbacks and recordings retain the unmodified video.
   */
  get beautyOptions(): Readonly<VideoBeautyOptions> | undefined {
    return this.storedBeautyOptions;
  }

  /**
   * Updates or disables beauty processing. Invalid strengths throw synchronously; asynchronous failures
   * restore original playback and report through beautyErrorHandler.
   */
  set beautyOptions(
    options: VideoBeautyOptions | undefined
  ) {
    this.storedBeautyOptions = options ? resolvedBeautyOptions(options) : undefined;
    if (!this.storedBeautyOptions) {
      this.stopBeauty();
    } else if (this.beautyController) {
      this.beautyController.update(this.storedBeautyOptions);
    } else {
      this.startBeauty();
    }
  }

  /**
   * Sets the next fade duration; zero skips animation but not warmup.
   */
  set fadeInDurationMs(
    durationMs: number
  ) {
    this.warmupController.fadeInDurationMs = durationMs;
  }

  /**
   * Whether video is visible; defaults to true. Hidden video retains playback, decoding, and trajectory
   * interaction.
   */
  get isVideoVisible(): boolean {
    return this.videoVisible;
  }

  /**
   * Changes video visibility without changing media or interaction settings.
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
   * Whether remote interaction is permitted. Local tracks have no interaction binding.
   */
  get isInteractionEnabled(): boolean {
    return this.interactionEnabled;
  }

  /**
   * Enables or disables interaction, cancelling current gestures immediately when disabled without
   * interrupting playback.
   */
  set isInteractionEnabled(
    enabled: boolean
  ) {
    this.interactionEnabled = enabled;
    this.trajectoryOverlay?.configure(
      this.contentMode,
      this.mirrored,
      enabled
    );
  }

  /**
   * The custom trajectory effect, or undefined for the SDK default.
   */
  get trajectoryRenderer(): TrajectoryEffectRendering | undefined {
    return this.customTrajectoryRenderer;
  }

  /**
   * Replaces visual effects after releasing old animation; the SDK retains sampling and message
   * delivery.
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
   * The currently displayed track, with old bindings removed on replacement.
   */
  get track(): RealtimeVideoTrack | undefined {
    return this.currentTrack;
  }

  /**
   * The presentation-statistics callback, invoked once per second; replacement, detachment, or
   * unavailable measurements report undefined.
   */
  get renderStatisticsHandler(): ((
    statistics?: VideoRenderStatistics
  ) => void) | undefined {
    return this.statisticsController.handler;
  }

  /**
   * Updates observation independently of playback, stopping statistics collection when removed.
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
   * Unbinds the old track, installs the replacement, and rearms one-shot first-frame notification.
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
   * The image layout mode.
   */
  get videoContentMode(): VideoContentMode {
    return this.contentMode;
  }

  /**
   * Changes layout without reapplying unchanged settings.
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
   * Whether display is mirrored, without affecting publication.
   */
  get isMirrored(): boolean {
    return this.mirrored;
  }

  /**
   * Updates the display transform without modifying media.
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
   * Attaches the view to a container.
   */
  attach(
    to: HTMLElement
  ): void {
    this.detached = false;
    to.appendChild(this.element);
    this.attachTrajectory();

    // Reattaching a MediaStream player may require resuming playback to restore frame callbacks.
    if (
      this.videoElement.srcObject && this.videoElement.autoplay &&
      !this.videoElement.ended && this.videoElement.paused && typeof this.videoElement.play === "function"
    ) {
      void this.videoElement.play().catch((error) => {
        XmaxLogger.render.warning(() => `恢复视频播放失败 (Failed to Resume Video Playback)\n└─ ${String(error)}`);
      });
    }

    this.startRenderStatistics();
    if (this.videoElement.srcObject && !this.hasNotifiedFrameDisplay) {
      this.prepareRenderWarmup();
      this.armFrameDisplayNotification();
    }
    this.startBeauty();
  }

  /**
   * Removes the view from its container.
   */
  detach(): void {
    this.detached = true;
    this.stopBeauty();
    this.disposeTrajectory();
    this.statisticsController.stop();
    this.cancelFrameDisplayNotification();
    this.warmupController.reset();
    this.hasNotifiedFrameDisplay = false;
    this.element.remove();
  }

  /**
   * Sets rendered media for custom bindings and direct playback.
   *
   * @internal
   */
  setMediaStream(
    stream: MediaStream | null
  ): void {
    if (this.sourceStream === stream) {
      return;
    }

    this.stopBeauty();
    this.sourceStream = stream;
    this.statisticsController.stop();
    this.cancelFrameDisplayNotification();
    this.hasNotifiedFrameDisplay = false;

    this.videoElement.srcObject = stream;
    this.warmupController.reset();
    if (stream) {
      this.videoElement.autoplay = true;
      this.prepareRenderWarmup();
      this.armFrameDisplayNotification();
      this.startRenderStatistics();
      this.startBeauty();
    }
  }

  /**
   * Restarts first-frame and warmup observation without replacing playing media.
   *
   * @internal
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
   * Uses a registered rendering binding or attaches the native media track directly.
   */
  private attachTrack(
    track: RealtimeVideoTrack
  ): void {
    const binding = VideoRenderRegistry.binding(track);
    if (binding) {
      binding.attachHandler(
        this,
        this.contentMode
      );
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
   * Unbinds the current track and clears presentation.
   */
  private detachCurrentTrack(): void {
    this.stopBeauty();
    this.warmupController.reset();
    this.disposeTrajectory();
    this.statisticsController.stop();
    const track = this.currentTrack;
    if (track) {
      VideoRenderRegistry.binding(track)?.detachHandler(this);
    }
    this.cancelFrameDisplayNotification();
    this.videoElement.srcObject = null;
    this.sourceStream = null;
  }

  /**
   * Starts lazy processing while the original source continues playing and drives startup readiness.
   */
  private startBeauty(): void {
    const options = this.storedBeautyOptions;
    const source = this.sourceStream;
    if (!options || !source || this.detached || this.beautyController) {
      return;
    }
    const track = source.getVideoTracks()[0];
    if (!track) {
      return;
    }
    const controller = new AgoraBeautyController(
      output => {
        if (this.beautyController === controller && !this.detached) {
          this.videoElement.srcObject = new MediaStream([output]);
        }
      },
      error => this.failBeauty(
        controller,
        error
      )
    );
    this.beautyController = controller;
    void controller.start(
      track,
      options
    ).catch(error => this.failBeauty(
      controller,
      XmaxError.from(error)
    ));
  }

  /**
   * Restores original playback before releasing effect resources, preserving warmup and interaction.
   */
  private stopBeauty(): void {
    const controller = this.beautyController;
    if (!controller) {
      return;
    }
    this.beautyController = undefined;
    this.videoElement.srcObject = this.sourceStream;
    void controller.dispose().catch(() => {
      XmaxLogger.render.warning(() => "美颜资源释放失败 (Beauty Cleanup Failed)");
    });
  }

  /**
   * Disables a failed effect without propagating failure to the media or generation lifecycle.
   */
  private failBeauty(
    controller: AgoraBeautyController,
    error: XmaxError
  ): void {
    if (this.beautyController !== controller) {
      return;
    }
    this.stopBeauty();
    this.storedBeautyOptions = undefined;
    XmaxLogger.render.warning(() => "美颜已关闭，恢复原始画面 (Beauty Disabled; Original Video Restored)");
    try {
      this.beautyErrorHandler?.(error);
    } catch {
      // App observers must not interrupt original playback.
    }
  }

  /**
   * Observes compositor submission, approximating readiness with playing on unsupported browsers.
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
    this.videoElement.addEventListener(
      "playing",
      this.onPlaying,
      {
        once: true,
      }
    );
    if (!this.videoElement.paused && this.videoElement.readyState >= 2) {
      queueMicrotask(notify);
    }
  }

  /**
   * Cancels first-frame observation on replacement, unbinding, or detachment so stale callbacks cannot
   * count toward a new stream.
   */
  private cancelFrameDisplayNotification(): void {
    this.frameNotificationSequence += 1;
    if (this.videoFrameCallbackID !== undefined) {
      this.videoElement.cancelVideoFrameCallback(this.videoFrameCallbackID);
      this.videoFrameCallbackID = undefined;
    }
    if (this.onPlaying) {
      this.videoElement.removeEventListener(
        "playing",
        this.onPlaying
      );
      this.onPlaying = undefined;
    }
  }

  /**
   * Enables warmup only for configured remote bindings; local and ordinary media display immediately.
   */
  private prepareRenderWarmup(): void {
    const binding = this.currentTrack ? VideoRenderRegistry.binding(this.currentTrack) : undefined;
    this.warmupController.prepare(binding?.renderWarmupMs);
    this.applyContentMode();
  }

  /**
   * Applies layout and mirroring styles.
   */
  private applyContentMode(): void {
    this.trajectoryOverlay?.configure(
      this.contentMode,
      this.mirrored,
      this.interactionEnabled
    );
    this.videoElement.style.objectFit = OBJECT_FIT[this.contentMode];
    this.videoElement.style.transform = this.mirrored ? "scaleX(-1)" : "";
  }

  /**
   * Starts presentation statistics while attached, delegating readiness and sampling to the statistics
   * controller.
   */
  private startRenderStatistics(): void {
    if (!this.detached) {
      this.statisticsController.start();
    }
  }

  /**
   * Creates an overlay only for interactive tracks, avoiding Canvas allocation for ordinary video and
   * local preview.
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
    overlay.configure(
      this.contentMode,
      this.mirrored,
      this.interactionEnabled
    );
    this.element.appendChild(overlay.element);
    binding.attach(overlay);
  }

  /**
   * Releases interaction resources on replacement or detachment; reattachment creates a fresh binding.
   */
  private disposeTrajectory(): void {
    this.trajectoryOverlay?.dispose();
    this.trajectoryOverlay = undefined;
  }
}
