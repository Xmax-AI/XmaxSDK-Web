//
//  MediaController.ts
//  XmaxSDK
//
//  Author: 翁跃庭 (Yueting Weng)
//  GitHub: https://github.com/Xmax-AI/XmaxSDK-Web
//
//  Copyright (c) 2026 XMAX.AI PTE. LTD.
//

import { XmaxError, XmaxErrorCode } from "../Foundation/Errors/XmaxError";
import type { RtcManaging } from "../Foundation/RTC/RtcManaging";
import type { MediaServicing } from "../Service/Media/MediaServicing";
import type { RealtimeVideoFormat } from "../Service/Realtime/RealtimeVideoFormat";
import { CameraController } from "./Camera/CameraController";
import type { CameraControlling, CameraPreviewReadyHandler } from "./Camera/CameraControlling";
import { LocalVideoController } from "./Video/LocalVideoController";
import { ExternalVideoController } from "./Video/ExternalVideoController";
import { ExternalFrameSourceController } from "./External/ExternalFrameSourceController";
import { LocalImageController } from "./Image/LocalImageController";
import { InteractionController } from "./Interaction/InteractionController";
import type { InteractionListener } from "./Interaction/InteractionControlling";
import type { InteractionFrame } from "./Interaction/InteractionFrame";
import type { MediaControlling } from "./MediaControlling";

/**
 * Owns local media and interaction controllers; Core serializes business operations while this layer
 * manages sources and RTC resources.
 */
export class MediaController implements MediaControlling {

  /**
   * The camera capture and preview controller.
   */
  private readonly camera: CameraControlling;

  /**
   * The local-file playback and audio/video output controller.
   */
  private readonly video: LocalVideoController;

  /**
   * The still-image video-output controller.
   */
  private readonly image: LocalImageController;

  /**
   * The external-track ownership and termination controller.
   */
  private readonly external: ExternalVideoController;

  /**
   * The external-frame-source, audio, and preview controller.
   */
  private readonly externalFrames: ExternalFrameSourceController;

  /**
   * The coordinate-mapping and serialized interaction sender.
   */
  private readonly interaction: InteractionController;

  /**
   * Creates a media controller from foundational services and failure/interaction callbacks.
   */
  constructor(
    private readonly dependencies: {
      rtcManager: RtcManaging;
      mediaService: MediaServicing;
      cameraController?: CameraControlling;
      onCameraError: (
        error: XmaxError
      ) => void;
      onVideoError: (
        error: XmaxError
      ) => void;
      onExternalError: (
        error: XmaxError
      ) => void;
      onImageError: (
        error: XmaxError
      ) => void;
      interactionListener: InteractionListener;
    }
  ) {
    this.camera = dependencies.cameraController ?? new CameraController({
      rtcManager: dependencies.rtcManager,
      mediaService: dependencies.mediaService,
      errorListener: dependencies.onCameraError,
    });
    this.video = new LocalVideoController(dependencies.onVideoError);
    this.image = new LocalImageController(dependencies.onImageError);
    this.external = new ExternalVideoController(dependencies.onExternalError);
    this.externalFrames = new ExternalFrameSourceController(dependencies.onExternalError);
    this.interaction = new InteractionController(dependencies.interactionListener);
  }

  /**
   * The current publishable source track.
   */
  get currentTrack() {
    return this.externalFrames.currentTrack
      ?? this.external.currentTrack
      ?? this.video.currentTrack
      ?? this.image.currentTrack
      ?? this.camera.currentTrack;
  }

  /**
   * The source kind derived from actual resources without duplicate media state.
   */
  get source(): MediaControlling["source"] {
    if (this.externalFrames.isActive || this.external.currentTrack) {
      return "externalVideo";
    }
    if (this.video.isActive) {
      return "localVideo";
    }
    if (this.image.isActive) {
      return "localImage";
    }
    if (this.camera.currentTrack) {
      return "camera";
    }

    return undefined;
  }

  /**
   * Whether the active source supplies publishable audio.
   */
  get hasAudio() {
    if (this.externalFrames.isActive) {
      return !!this.externalFrames.audioTrack;
    }
    return this.video.isActive ? !!this.video.audioTrack : this.source === "camera" && this.camera.useMicrophone;
  }

  /**
   * Whether this camera source requires pre-publication warmup.
   */
  get isFrameValidationEnabled() {
    return this.source === "camera" && this.camera.isFrameValidationEnabled;
  }

  /**
   * Rejects creation over an active source or pending media preparation.
   */
  ensureNoLocalSource(): void {
    if (this.currentTrack || this.externalFrames.isActive || this.video.isActive || this.image.isActive) {
      throw new XmaxError(
        XmaxErrorCode.invalidConfiguration,
        "Close the current local stream before creating another one"
      );
    }
  }

  /**
   * Validates the adapter's external-media capability.
   */
  validateExternalMediaSupport(
    kind: "local" | "external" | "image"
  ): void {
    if (!this.dependencies.rtcManager.setExternalMediaTracks) {
      throw new XmaxError(
        XmaxErrorCode.invalidConfiguration,
        `The RTC provider does not support ${kind} video streams`
      );
    }
  }

  /**
   * Creates camera media using the camera controller's RTC and preview resources.
   */
  createLocalCameraStream(
    options: Parameters<MediaControlling["createLocalCameraStream"]>[0]
  ) {
    this.ensureNoLocalSource();
    return this.camera.createLocalCameraStream(options);
  }

  /**
   * Updates the active camera format without replacing preview or other media resources.
   */
  updateCameraFormat(
    videoFormat: RealtimeVideoFormat
  ): Promise<void> {
    if (this.source !== "camera") {
      throw new XmaxError(
        XmaxErrorCode.invalidConfiguration,
        "Camera preview is not started"
      );
    }
    return this.camera.updateVideoFormat(videoFormat);
  }

  /**
   * Unlocks user-initiated playback before prepareSource initializes RTC.
   */
  createLocalVideoStream(
    options: Parameters<MediaControlling["createLocalVideoStream"]>[0],
    signal: AbortSignal
  ) {
    this.ensureNoLocalSource();
    return this.video.create(
      options,
      this.dependencies.mediaService,
      signal
    );
  }

  /**
   * Decodes an image into a still-video track without requesting device permission.
   */
  createLocalImageStream(
    options: Parameters<MediaControlling["createLocalImageStream"]>[0],
    signal: AbortSignal
  ) {
    this.ensureNoLocalSource();
    return this.image.create(
      options,
      this.dependencies.mediaService,
      signal
    );
  }

  /**
   * Binds a frame source or compatibility-track clone without stopping app-owned capture.
   */
  async createExternalVideoStream(
    options: Parameters<MediaControlling["createExternalVideoStream"]>[0],
    signal: AbortSignal
  ) {
    this.ensureNoLocalSource();
    if (options.source !== undefined) {
      if (options.videoTrack !== undefined || options.videoFormat !== undefined) {
        throw new XmaxError(
          XmaxErrorCode.invalidConfiguration,
          "External source and video track options cannot be combined"
        );
      }
      return this.externalFrames.create(
        options.source,
        this.dependencies.mediaService,
        signal
      );
    }
    return this.external.create(
      options,
      this.dependencies.mediaService
    );
  }

  /**
   * Passes publication state to external audio without affecting camera or file sources.
   */
  setExternalAudioPublished(
    published: boolean
  ): void {
    this.externalFrames.setAudioPublished(published);
  }

  /**
   * Initializes RTC and installs non-camera tracks, validating operation ownership across asynchronous
   * boundaries.
   */
  async prepareSource(
    ensureCurrent: () => void
  ): Promise<void> {
    const rtc = this.dependencies.rtcManager;
    await rtc.initialize();
    ensureCurrent();

    const track = this.externalFrames.currentTrack
      ?? this.external.currentTrack
      ?? this.video.currentTrack
      ?? this.image.currentTrack;
    if (track?.mediaStreamTrack) {
      await rtc.setExternalMediaTracks!({
        videoTrack: track.mediaStreamTrack,
        audioTrack: this.externalFrames.isActive ? this.externalFrames.audioTrack : this.video.audioTrack
      });
      ensureCurrent();
    }
  }

  /**
   * Sets the camera-preview readiness callback.
   */
  setCameraPreviewReadyHandler(
    handler?: CameraPreviewReadyHandler
  ): void {
    this.camera.setPreviewReadyHandler(handler);
  }

  /**
   * Waits for camera warmup.
   */
  waitForValidCameraFrame(
    signal: AbortSignal
  ): Promise<void> {
    return this.camera.waitForValidCameraFrame(signal);
  }

  /**
   * Switches camera capture; external devices remain controlled by your app.
   */
  switchCamera() {
    if (this.externalFrames.isActive || this.external.currentTrack) {
      throw new XmaxError(
        XmaxErrorCode.invalidConfiguration,
        "External video capture is managed by the caller"
      );
    }
    return this.camera.switchCamera();
  }

  /**
   * Stops camera resources.
   */
  stopLocalCameraStream(): Promise<void> {
    return this.camera.stopLocalCameraStream();
  }

  /**
   * Starts file playback after generation signaling.
   */
  startLocalVideo(
    signal: AbortSignal
  ): Promise<void> {
    return this.video.start(signal);
  }

  /**
   * Pauses the file timeline while retaining preview resources during disconnection.
   */
  pauseLocalVideo(): void {
    this.video.pause();
  }

  /**
   * Releases the current source, ensuring RTC teardown failure does not skip external-track or decoder
   * cleanup.
   */
  async stopLocalStream(): Promise<void> {
    this.stopInteraction();
    const external = this.source !== undefined && this.source !== "camera";
    this.externalFrames.invalidate();

    try {
      if (external) {
        await this.dependencies.rtcManager.destroy();
      } else {
        await this.camera.stopLocalCameraStream();
      }
    } finally {
      this.external.stop();
      await this.externalFrames.stop();
      if (this.image.isActive) {
        this.image.stop();
      }
      if (this.video.isActive) {
        await this.video.stop();
      }
    }
  }

  /**
   * Enables interaction against the fixed media baseline, including normalized external-video
   * coordinates. Adapted encoding dimensions and generation canvases do not affect this mapping.
   */
  startInteraction(
    taskID: string,
    format: RealtimeVideoFormat
  ): void {
    this.interaction.startInteraction(
      taskID,
      format
    );
  }

  /**
   * Drops pending interaction samples immediately when a task ends.
   */
  stopInteraction(): void {
    this.interaction.stopInteraction();
  }

  /**
   * Routes a render-layer snapshot through coordinate mapping and message submission.
   */
  submitInteraction(
    frame: InteractionFrame
  ): void {
    this.interaction.submitInteraction(frame);
  }
}
