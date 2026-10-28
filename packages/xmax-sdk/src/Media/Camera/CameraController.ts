//
//  CameraController.ts
//  XmaxSDK
//
//  Author: 翁跃庭 (Yueting Weng)
//  GitHub: https://github.com/Xmax-AI/XmaxSDK-Web
//
//  Copyright (c) 2026 XMAX.AI PTE. LTD.
//

import { CameraPosition } from "../../Foundation/Media/Camera/CameraPosition";
import { validateCameraRotation, type CameraRotation } from "../../Foundation/Media/Camera/CameraRotation";
import { waitForValidCameraFrame } from "../../Foundation/Media/Camera/CameraFrameValidator";
import { XmaxError, XmaxErrorCode, type XmaxErrorListener } from "../../Foundation/Errors/XmaxError";
import type { PermissionManaging } from "../../Foundation/Permissions/PermissionManaging";
import { PermissionManager } from "../../Foundation/Permissions/PermissionManager";
import type { RtcManaging } from "../../Foundation/RTC/RtcManaging";
import { TrtcRtcManager } from "../../Foundation/RTC/TRTC/TrtcRtcManager";
import { VideoRenderRegistry } from "../../Render/Video/VideoRenderRegistry";
import type { MediaServicing } from "../../Service/Media/MediaServicing";
import { MediaService } from "../../Service/Media/MediaService";
import { RealtimeMediaStream } from "../../Service/Realtime/RealtimeMediaStream";
import type { RealtimeVideoFormat } from "../../Service/Realtime/RealtimeVideoFormat";
import { RealtimeVideoTrack } from "../../Service/Realtime/RealtimeVideoTrack";
import { StreamID } from "../../Stream/StreamID";
import type { CameraControlling, CameraPreviewReadyHandler } from "./CameraControlling";

/**
 * Coordinates camera capture and SDK preview.
 *
 * RTC supplies unpublished capture. Track replacement updates the existing preview stream without
 * rebinding mounted views. RTC starts microphone capture during connection; this controller retains its
 * settings and permissions.
 */
export class CameraController implements CameraControlling {

  /**
   * The SDK ID assigned to local camera video.
   */
  private static readonly localVideoTrackID = "video0";

  /**
   * The camera and microphone permission checker.
   */
  private readonly permissionManager: PermissionManaging;

  /**
   * The configured RTC capture and transport adapter.
   */
  private readonly rtcManager: RtcManaging;

  /**
   * The service resolving model input dimensions.
   */
  private readonly mediaService: MediaServicing;

  /**
   * The runtime capture-error listener.
   */
  private readonly errorListener: XmaxErrorListener;

  /**
   * The readiness callback requiring both a captured frame and bound preview.
   */
  private previewReadyHandler?: CameraPreviewReadyHandler;

  /**
   * The active SDK camera track.
   */
  private activeTrack?: RealtimeVideoTrack;

  /**
   * The browser media stream used for camera preview.
   */
  private previewStream?: MediaStream;

  /**
   * The callback applying preview mirroring.
   */
  private previewMirrorApplier?: (
    mirrored: boolean
  ) => void;

  /**
   * Whether a valid camera frame has arrived.
   */
  private hasCapturedFrame = false;

  /**
   * Whether a preview target is attached.
   */
  private isPreviewAttached = false;

  /**
   * Whether the current camera configuration includes microphone capture.
   */
  private storedUseMicrophone = false;

  /**
   * Whether the current camera source enables pre-publication warmup.
   */
  private storedFrameValidationEnabled = true;

  /**
   * The current clockwise camera rotation, retained across format updates.
   */
  private storedRotation: CameraRotation = 0;

  /**
   * The track being reformatted, whose obsolete native-track end events are ignored during replacement.
   */
  private formatUpdatingTrack?: RealtimeVideoTrack;

  /**
   * Creates a camera controller.
   *
   * @param options.permissionManager - The permission checker.
   * @param options.rtcManager - The capture and transport adapter.
   * @param options.mediaService - The model-sizing service.
   * @param options.errorListener - The runtime error listener.
   */
  constructor(
    options?: {
      permissionManager?: PermissionManaging;
      rtcManager?: RtcManaging;
      mediaService?: MediaServicing;
      errorListener?: XmaxErrorListener;
    }
  ) {
    this.permissionManager = options?.permissionManager ?? new PermissionManager();
    this.rtcManager = options?.rtcManager ?? new TrtcRtcManager();
    this.mediaService = options?.mediaService ?? new MediaService();
    this.errorListener = options?.errorListener ?? (() => { });
  }

  /**
   * The active local camera track, or undefined before creation.
   */
  get currentTrack(): RealtimeVideoTrack | undefined {
    return this.activeTrack;
  }

  /**
   * Whether the active camera source is configured to use microphone input.
   */
  get useMicrophone(): boolean {
    return this.activeTrack !== undefined && this.storedUseMicrophone;
  }

  /**
   * Whether the active camera source enables pre-publication warmup; false without an active source.
   */
  get isFrameValidationEnabled(): boolean {
    return this.activeTrack !== undefined && this.storedFrameValidationEnabled;
  }

  /**
   * Waits for the fixed 200 ms warmup unless disabled, rejecting cancellation or track replacement.
   */
  async waitForValidCameraFrame(
    signal: AbortSignal
  ): Promise<void> {
    const track = this.activeTrack;
    const mediaTrack = track?.mediaStreamTrack;
    if (!mediaTrack) {
      throw new XmaxError(
        XmaxErrorCode.mediaError,
        "Camera capture is not running"
      );
    }
    if (signal.aborted) {
      throw new XmaxError(
        XmaxErrorCode.cancelled,
        "Camera frame validation cancelled"
      );
    }
    if (!this.isFrameValidationEnabled) {
      return;
    }

    await waitForValidCameraFrame(
      mediaTrack,
      signal
    );

    if (this.activeTrack !== track || track.mediaStreamTrack !== mediaTrack) {
      throw new XmaxError(
        XmaxErrorCode.cancelled,
        "Camera track changed during warmup"
      );
    }
  }

  /**
   * Sets a one-shot readiness callback requiring a valid frame and a bound preview.
   */
  setPreviewReadyHandler(
    handler?: CameraPreviewReadyHandler
  ): void {
    this.previewReadyHandler = handler;
    const track = this.activeTrack;
    if (track) {
      this.notifyPreviewReady(track);
    }
  }

  /**
   * Creates and starts local camera media.
   *
   * @param options.videoFormat - The desired post-rotation dimensions, frame rate, and encoding
   * settings, resolved by model rules.
   * @param options.position - The initial camera position.
   * @param options.rotation - Clockwise input rotation; defaults to 0. Nonzero values currently require
   * Agora.
   * @param options.useMicrophone - Whether to request microphone permission and allow audio capture
   * during connection.
   * @param options.enableFrameValidation - Whether to wait for a fixed 200 ms pre-publication warmup;
   * defaults to true.
   * @returns A media stream containing the local camera track.
   * @throws Rejects for active capture, invalid formats, denied permission, or capture-start failure.
   */
  async createLocalCameraStream(
    options: {
      videoFormat: RealtimeVideoFormat;
      position: CameraPosition;
      useMicrophone: boolean;
      rotation?: CameraRotation;
      enableFrameValidation?: boolean;
    }
  ): Promise<RealtimeMediaStream> {
    if (this.activeTrack) {
      throw new XmaxError(
        XmaxErrorCode.invalidConfiguration,
        "Stop the current local camera stream before creating another one",
      );
    }

    validateCameraRotation(options.rotation ?? 0);
    const resolvedFormat = this.resolveVideoFormat(options.videoFormat);
    const track = new RealtimeVideoTrack({
      id: CameraController.localVideoTrackID,
      videoFormat: resolvedFormat,
      position: options.position,
    });

    try {
      await this.permissionManager.ensureCameraPermission();
      if (options.useMicrophone) {
        await this.permissionManager.ensureMicrophonePermission();
      }

      await this.rtcManager.initialize();

      this.activeTrack = track;
      this.storedUseMicrophone = options.useMicrophone;
      this.storedFrameValidationEnabled = options.enableFrameValidation ?? true;
      this.storedRotation = options.rotation ?? 0;
      this.hasCapturedFrame = false;
      this.isPreviewAttached = false;
      this.registerPreviewBinding(track);

      const mediaTrack = await this.rtcManager.startCameraCapture({
        width: resolvedFormat.width,
        height: resolvedFormat.height,
        frameRate: resolvedFormat.fps,
        position: options.position,
        ...(options.rotation !== undefined ? { rotation: options.rotation } : {}),
      });
      track.mediaStreamTrack = mediaTrack;
      this.previewStream = new MediaStream([mediaTrack]);
      this.observeMediaTrack(
        track,
        mediaTrack
      );

      return new RealtimeMediaStream({
        id: StreamID.local,
        videoTrack: track
      });
    } catch (error) {
      await this.stopLocalCameraStream();
      throw XmaxError.from(error);
    }
  }

  /**
   * Stops capture, destroys the RTC engine, and releases the camera track and preview resources.
   */
  async stopLocalCameraStream(): Promise<void> {
    const track = this.activeTrack;
    this.activeTrack = undefined;
    this.previewReadyHandler = undefined;
    this.previewStream = undefined;
    this.previewMirrorApplier = undefined;

    this.storedUseMicrophone = false;
    this.storedFrameValidationEnabled = true;
    this.storedRotation = 0;
    this.hasCapturedFrame = false;
    this.isPreviewAttached = false;

    await this.rtcManager.stopCameraCapture();
    await this.rtcManager.destroy();

    if (track) {
      VideoRenderRegistry.unregister(track);
      track.mediaStreamTrack = undefined;
    }
  }

  /**
   * Updates capture settings, replacing preview tracks and metadata only after success and retaining
   * existing bindings on failure.
   */
  async updateVideoFormat(
    videoFormat: RealtimeVideoFormat
  ): Promise<void> {
    const track = this.activeTrack;
    const position = track?.position;
    if (!track || !position || !track.mediaStreamTrack) {
      throw new XmaxError(
        XmaxErrorCode.invalidConfiguration,
        "Camera preview is not started"
      );
    }
    const resolved = this.resolveVideoFormat(videoFormat);
    if (!this.rtcManager.updateCameraCapture) {
      throw new XmaxError(
        XmaxErrorCode.invalidConfiguration,
        "The RTC provider does not support camera format updates"
      );
    }

    const previous = track.mediaStreamTrack;
    this.formatUpdatingTrack = track;
    try {
      const mediaTrack = await this.rtcManager.updateCameraCapture({
        width: resolved.width,
        height: resolved.height,
        frameRate: resolved.fps,
        position,
        rotation: this.storedRotation,
      });
      if (this.activeTrack !== track) {
        throw new XmaxError(
          XmaxErrorCode.cancelled,
          "Camera stream changed during format update"
        );
      }

      track.updateVideoFormat(resolved);
      track.mediaStreamTrack = mediaTrack;
      if (previous !== mediaTrack) {
        this.previewStream?.removeTrack(previous);
        this.previewStream?.addTrack(mediaTrack);
        this.observeMediaTrack(
          track,
          mediaTrack
        );
      }
    } finally {
      if (this.formatUpdatingTrack === track) {
        this.formatUpdatingTrack = undefined;
      }
      if (this.activeTrack === track && track.mediaStreamTrack?.readyState === "ended") {
        this.errorListener(new XmaxError(
          XmaxErrorCode.mediaError,
          "Camera capture ended during format update"
        ));
      }
    }
  }

  /**
   * Switches cameras while retaining the SDK track.
   *
   * The native replacement updates the existing preview stream; RTC owns old-track cleanup, so mounted
   * views need no rebinding.
   *
   * @returns The stream with updated camera media.
   * @throws Rejects without active capture or if switching fails.
   */
  async switchCamera(): Promise<RealtimeMediaStream> {
    const track = this.activeTrack;
    const position = track?.position;
    if (!track || !position) {
      throw new XmaxError(
        XmaxErrorCode.rtcError,
        "Local camera preview is not started",
      );
    }

    const nextPosition =
      position === CameraPosition.front ? CameraPosition.back : CameraPosition.front;

    // Capture-switch failure retains the previous device.
    const mediaTrack = await this.rtcManager.switchCameraCapture(nextPosition);

    const previousTrack = track.mediaStreamTrack;
    track.updatePosition(nextPosition);
    track.mediaStreamTrack = mediaTrack;

    if (this.previewStream) {
      if (previousTrack) {
        this.previewStream.removeTrack(previousTrack);
      }
      this.previewStream.addTrack(mediaTrack);
    }
    this.previewMirrorApplier?.(nextPosition === CameraPosition.front);
    this.observeMediaTrack(
      track,
      mediaTrack
    );

    return new RealtimeMediaStream({
      id: StreamID.local,
      videoTrack: track
    });
  }

  /**
   * Registers preview attachment, media delivery, and mirroring for a camera track.
   */
  private registerPreviewBinding(
    track: RealtimeVideoTrack
  ): void {
    VideoRenderRegistry.register(
      track,
      {
        attachHandler: (view) => {
          const stream = this.previewStream;
          if (!stream) {
            throw new XmaxError(
              XmaxErrorCode.mediaError,
              "Camera capture is not running",
            );
          }

          view.isMirrored = track.position === CameraPosition.front;
          view.setMediaStream(stream);
          this.previewMirrorApplier = (mirrored) => {
            view.isMirrored = mirrored;
          };

          this.isPreviewAttached = true;
          this.notifyPreviewReady(track);
        },
        detachHandler: (view) => {
          view.setMediaStream(null);
          this.previewMirrorApplier = undefined;
          this.isPreviewAttached = false;
        },
      }
    );
  }

  /**
   * Observes the first frame for preview readiness and unexpected track termination for failure
   * reporting.
   */
  private observeMediaTrack(
    track: RealtimeVideoTrack,
    mediaTrack: MediaStreamTrack,
  ): void {
    const isCurrent = () =>
      this.activeTrack === track && track.mediaStreamTrack === mediaTrack;
    if (mediaTrack.muted) {
      mediaTrack.addEventListener(
        "unmute",
        () => {
          if (!isCurrent()) {
            return;
          }
          this.hasCapturedFrame = true;
          this.notifyPreviewReady(track);
        },
        { once: true },
      );
    } else {
      this.hasCapturedFrame = true;
      this.notifyPreviewReady(track);
    }
    mediaTrack.addEventListener(
      "ended",
      () => {
        if (!isCurrent() || this.formatUpdatingTrack === track) {
          return;
        }
        this.errorListener(
          new XmaxError(
            XmaxErrorCode.mediaError,
            "Camera video track ended unexpectedly",
          ),
        );
      }
    );
  }

  /**
   * Invokes readiness once after both a valid frame and preview attachment.
   */
  private notifyPreviewReady(
    track: RealtimeVideoTrack
  ): void {
    if (
      this.activeTrack !== track ||
      !this.hasCapturedFrame ||
      !this.isPreviewAttached ||
      !this.previewReadyHandler
    ) {
      return;
    }
    const handler = this.previewReadyHandler;
    this.previewReadyHandler = undefined;
    handler(() => this.activeTrack === track);
  }

  /**
   * Resolves the requested format according to model input rules.
   */
  private resolveVideoFormat(
    videoFormat: RealtimeVideoFormat
  ): RealtimeVideoFormat {
    videoFormat.validate();
    const targetSize = this.mediaService.resolveMediaSize(
      {
        width: videoFormat.width,
        height: videoFormat.height,
      },
      "camera"
    );
    const resolvedFormat = videoFormat.resized(
      targetSize.width,
      targetSize.height
    );
    resolvedFormat.validate();
    return resolvedFormat;
  }
}
