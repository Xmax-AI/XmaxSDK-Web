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
import { waitForCameraWarmup } from "../../Foundation/Media/Camera/CameraWarmup";
import { XmaxError, XmaxErrorCode, type XmaxErrorListener } from "../../Foundation/Errors/XmaxError";
import type { PermissionManaging } from "../../Foundation/Permissions/PermissionManaging";
import { PermissionManager } from "../../Foundation/Permissions/PermissionManager";
import type { RtcManaging } from "../../Foundation/RTC/RtcManaging";
import { VideoRenderRegistry } from "../../Render/Video/VideoRenderRegistry";
import type { MediaServicing } from "../../Service/Media/MediaServicing";
import { MediaService } from "../../Service/Media/MediaService";
import { RealtimeCamera } from "../../Service/Realtime/RealtimeCamera";
import type { RealtimeMediaFrameListener } from "../../Service/Realtime/RealtimeMediaFrame";
import { RealtimeMediaStream } from "../../Service/Realtime/RealtimeMediaStream";
import { RealtimeMicrophone } from "../../Service/Realtime/RealtimeMicrophone";
import type { RealtimeVideoFormat } from "../../Service/Realtime/RealtimeVideoFormat";
import { RealtimeVideoTrack } from "../../Service/Realtime/RealtimeVideoTrack";
import { StreamID } from "../../Stream/StreamID";
import { captureMicrophone } from "../Audio/MicrophoneCapture";
import { CameraCapture } from "./CameraCapture";
import type { CameraControlling, CameraPreviewReadyHandler, CameraStreamOptions } from "./CameraControlling";
import { LocalMediaFrameController } from "./LocalMediaFrameController";

/**
 * Coordinates camera capture and SDK preview.
 *
 * Owns browser capture and gives RTC the tracks needed for publication. Track replacement updates
 * existing preview bindings and a connected RTC sender.
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
   * Observes the capture tracks for app callbacks.
   */
  private readonly mediaFrames = new LocalMediaFrameController();

  /**
   * The readiness callback requiring both a captured frame and bound preview.
   */
  private previewReadyHandler?: CameraPreviewReadyHandler;

  /**
   * The active SDK camera track.
   */
  private activeTrack?: RealtimeVideoTrack;

  /** The active browser camera. */
  private capture?: CameraCapture;

  /** The target media format, independent of uplink adaptation. */
  private targetFormat?: RealtimeVideoFormat;

  /** Microphone capture and RTC bindings belong to a connection, rather than to preview. */
  private microphone?: MediaStreamTrack;
  private rtcPrepared = false;

  /**
   * The browser media stream used for camera preview.
   */
  private previewStream?: MediaStream;

  /**
   * Whether a valid camera frame has arrived.
   */
  private hasCapturedFrame = false;

  /**
   * Whether a preview target is attached.
   */
  private isPreviewAttached = false;

  /**
   * The microphone selection retained across reconnections.
   */
  private microphoneSelection: RealtimeMicrophone = RealtimeMicrophone.disabled;

  /**
   * The configured camera warmup before RTC publication, in milliseconds.
   */
  private configuredWarmupMs = 0;

  /**
   * The current clockwise camera rotation, retained across format updates.
   */
  private storedRotation: CameraRotation = 0;

  /**
   * The explicit mirror choice retained across camera switches.
   */
  private storedMirror?: boolean;

  /**
   * The track being reformatted, whose obsolete native-track end events are ignored during replacement.
   */
  private formatUpdatingTrack?: RealtimeVideoTrack;

  /**
   * Creates a camera controller.
   *
   * @param options.permissionManager - The permission checker.
   * @param options.rtcManager - The transport adapter.
   * @param options.mediaService - The model-sizing service.
   * @param options.errorListener - The runtime error listener.
   */
  constructor(
    options: {
      permissionManager?: PermissionManaging;
      rtcManager: RtcManaging;
      mediaService?: MediaServicing;
      errorListener?: XmaxErrorListener;
    }
  ) {
    this.permissionManager = options.permissionManager ?? new PermissionManager();
    this.rtcManager = options.rtcManager;
    this.mediaService = options.mediaService ?? new MediaService();
    this.errorListener = options.errorListener ?? (() => { });
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
    return this.activeTrack !== undefined && this.microphoneSelection.kind !== "disabled";
  }

  /**
   * The active camera's additional warmup before RTC publication.
   */
  get warmupMs(): number {
    return this.configuredWarmupMs;
  }

  /**
   * Sets or removes the app's capture-frame listener.
   */
  setLocalMediaFrameListener(
    listener?: RealtimeMediaFrameListener
  ): Promise<void> {
    return this.mediaFrames.setListener(listener);
  }

  /**
   * Waits for the configured warmup, rejecting cancellation or track replacement.
   */
  async waitForCameraWarmup(
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
        "Camera warmup cancelled"
      );
    }
    if (this.warmupMs === 0) {
      return;
    }

    await waitForCameraWarmup(
      mediaTrack,
      this.warmupMs,
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
   */
  async createLocalCameraStream(
    options: CameraStreamOptions,
    signal: AbortSignal
  ): Promise<RealtimeMediaStream> {
    if (this.activeTrack) {
      throw new XmaxError(
        XmaxErrorCode.invalidConfiguration,
        "Stop the current local camera stream before creating another one",
      );
    }

    const {
      videoFormat,
      captureFormat,
      camera,
      microphone = RealtimeMicrophone.disabled,
      rotation = 0,
      mirror,
      warmupMs = 0,
    } = options;
    if (captureFormat !== undefined && (
      !captureFormat ||
      !Number.isInteger(captureFormat.width) || captureFormat.width <= 0 ||
      !Number.isInteger(captureFormat.height) || captureFormat.height <= 0 ||
      (captureFormat.fps !== undefined && (!Number.isFinite(captureFormat.fps) || captureFormat.fps <= 0))
    )) {
      throw new XmaxError(
        XmaxErrorCode.invalidConfiguration,
        "Camera capture dimensions must be positive integers and fps must be finite and positive"
      );
    }
    const requestedCaptureFormat = captureFormat && {
      width: captureFormat.width,
      height: captureFormat.height,
      fps: captureFormat.fps,
    };
    validateCameraRotation(rotation);
    if (!Number.isFinite(warmupMs) || warmupMs < 0) {
      throw new XmaxError(
        XmaxErrorCode.invalidConfiguration,
        "Camera warmup must be a finite, non-negative number of milliseconds"
      );
    }
    if (mirror !== undefined && typeof mirror !== "boolean") {
      throw new XmaxError(
        XmaxErrorCode.invalidConfiguration,
        "Camera mirror must be a boolean"
      );
    }
    const resolvedFormat = this.resolveVideoFormat(videoFormat);
    const track = new RealtimeVideoTrack({
      id: CameraController.localVideoTrackID,
      videoFormat: resolvedFormat
    });

    try {
      await this.permissionManager.ensureCameraPermission();
      if (microphone.kind !== "disabled") {
        await this.permissionManager.ensureMicrophonePermission();
      }
      if (signal.aborted) {
        throw new XmaxError(XmaxErrorCode.cancelled, "Camera capture cancelled");
      }

      this.activeTrack = track;
      this.microphoneSelection = microphone;
      this.configuredWarmupMs = warmupMs;
      this.storedRotation = rotation;
      this.storedMirror = mirror;
      this.hasCapturedFrame = false;
      this.isPreviewAttached = false;
      this.registerPreviewBinding(track);

      const { capture, track: mediaTrack } = await this.openCapture(
        resolvedFormat,
        requestedCaptureFormat,
        camera,
        signal
      );
      if (signal.aborted || this.activeTrack !== track) {
        capture.stop();
        throw new XmaxError(XmaxErrorCode.cancelled, "Camera stream changed during capture");
      }
      this.capture = capture;
      this.targetFormat = resolvedFormat;
      track.updatePosition(capture.position);
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
      if (this.activeTrack === track) {
        await this.stopLocalCameraStream();
      }
      throw XmaxError.from(error);
    }
  }

  /**
   * Prepares the browser tracks for RTC publication, starting microphone input only on connection.
   */
  async prepareForConnection(signal: AbortSignal): Promise<void> {
    const videoTrack = this.activeTrack?.mediaStreamTrack;
    const rtc = this.rtcManager;
    if (!videoTrack) {
      throw new XmaxError(XmaxErrorCode.invalidConfiguration, "Camera tracks cannot be published");
    }
    const selection = this.microphoneSelection;
    if (selection.kind !== "disabled") {
      const microphone = await captureMicrophone(
        signal,
        selection.kind === "device" ? selection.id : undefined
      );
      this.microphone = microphone;
      microphone.addEventListener("ended", () => {
        if (this.microphone === microphone) {
          this.mediaFrames.setSource(this.activeTrack?.mediaStreamTrack);
          this.errorListener(new XmaxError(XmaxErrorCode.mediaError, "Microphone track ended unexpectedly"));
        }
      }, { once: true });
    }
    if (signal.aborted) {
      throw new XmaxError(XmaxErrorCode.cancelled, "Camera publication preparation cancelled");
    }
    this.mediaFrames.setSource(
      videoTrack,
      this.microphone
    );
    this.rtcPrepared = true;
    await rtc.initialize();
    if (signal.aborted) {
      throw new XmaxError(XmaxErrorCode.cancelled, "Camera publication preparation cancelled");
    }
    await rtc.setExternalMediaTracks({ videoTrack, audioTrack: this.microphone, source: "camera" });
  }

  /** Releases connection-owned audio and RTC track clones while leaving camera preview available. */
  async releaseConnectionMedia(): Promise<void> {
    const microphone = this.microphone;
    this.microphone = undefined;
    this.mediaFrames.setSource(this.activeTrack?.mediaStreamTrack);
    microphone?.stop();
    if (this.rtcPrepared) {
      this.rtcPrepared = false;
      await this.rtcManager.destroy();
    }
  }

  /**
   * Stops capture and releases the camera track and preview resources.
   */
  async stopLocalCameraStream(): Promise<void> {
    const track = this.activeTrack;
    this.activeTrack = undefined;
    this.previewReadyHandler = undefined;
    this.previewStream = undefined;
    this.mediaFrames.setSource(undefined);

    this.microphoneSelection = RealtimeMicrophone.disabled;
    this.configuredWarmupMs = 0;
    this.storedRotation = 0;
    this.storedMirror = undefined;
    this.hasCapturedFrame = false;
    this.isPreviewAttached = false;

    this.capture?.stop();
    this.capture = undefined;
    this.targetFormat = undefined;

    if (track) {
      VideoRenderRegistry.unregister(track);
      track.mediaStreamTrack = undefined;
    }
    await this.releaseConnectionMedia();
  }

  /**
   * Updates capture settings, replacing preview tracks and metadata only after success and retaining
   * existing bindings on failure.
   */
  async updateVideoFormat(
    videoFormat: RealtimeVideoFormat,
    signal: AbortSignal
  ): Promise<void> {
    const track = this.activeTrack;
    const capture = this.capture;
    if (!track || !capture || !track.mediaStreamTrack) {
      throw new XmaxError(
        XmaxErrorCode.invalidConfiguration,
        "Camera preview is not started"
      );
    }
    const resolved = this.resolveVideoFormat(videoFormat);
    const previous = track.mediaStreamTrack;
    this.formatUpdatingTrack = track;
    try {
      const mediaTrack = await capture.updateFormat(resolved, signal);
      if (signal.aborted || this.activeTrack !== track) {
        throw new XmaxError(
          XmaxErrorCode.cancelled,
          "Camera stream changed during format update"
        );
      }

      this.targetFormat = resolved;
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
   * The replacement is published and bound to preview before releasing the old device.
   *
   * @returns The stream with updated camera media.
   * @throws Rejects without active capture or if switching fails.
   */
  async switchCamera(signal: AbortSignal): Promise<RealtimeMediaStream> {
    const track = this.activeTrack;
    const position = track?.position;
    const format = this.targetFormat;
    if (!track || !format) {
      throw new XmaxError(
        XmaxErrorCode.rtcError,
        "Local camera preview is not started",
      );
    }
    if (position === undefined) {
      throw new XmaxError(
        XmaxErrorCode.invalidConfiguration,
        "Camera switching requires a known front or rear position"
      );
    }

    const nextPosition =
      position === CameraPosition.front ? CameraPosition.back : CameraPosition.front;

    const { capture, track: mediaTrack } = await this.openCapture(
      format,
      this.capture?.captureFormat,
      RealtimeCamera.position(nextPosition),
      signal
    );
    try {
      if (signal.aborted || this.activeTrack !== track) {
        throw new XmaxError(XmaxErrorCode.cancelled, "Camera stream changed during switching");
      }
      if (this.rtcPrepared) {
        await this.rtcManager.replaceCameraVideoTrack(mediaTrack);
      }
      if (signal.aborted || this.activeTrack !== track) {
        throw new XmaxError(XmaxErrorCode.cancelled, "Camera stream changed during switching");
      }
      const previousTrack = track.mediaStreamTrack;
      const previousCapture = this.capture;
      this.capture = capture;
      track.updatePosition(capture.position);
      track.mediaStreamTrack = mediaTrack;

      if (previousTrack) {
        this.previewStream?.removeTrack(previousTrack);
      }
      this.previewStream?.addTrack(mediaTrack);
      this.observeMediaTrack(track, mediaTrack);
      previousCapture?.stop();
    } catch (error) {
      capture.stop();
      throw error;
    }

    return new RealtimeMediaStream({
      id: StreamID.local,
      videoTrack: track
    });
  }

  /** Reports frame processing failures only for the camera committed as the active input. */
  private async openCapture(
    format: RealtimeVideoFormat,
    captureFormat: CameraStreamOptions["captureFormat"],
    camera: RealtimeCamera,
    signal: AbortSignal
  ): Promise<{ capture: CameraCapture; track: MediaStreamTrack }> {
    let candidate: CameraCapture | undefined;
    const result = await CameraCapture.open(
      format,
      captureFormat,
      camera,
      this.storedRotation,
      this.storedMirror,
      error => {
        if (candidate && candidate === this.capture) {
          this.errorListener(error);
        }
      },
      signal
    );
    candidate = result.capture;
    return result;
  }

  /**
   * Registers preview attachment and delivery of the processed camera track.
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

          view.isMirrored = false;
          view.setMediaStream(stream);

          this.isPreviewAttached = true;
          this.notifyPreviewReady(track);
        },
        detachHandler: (view) => {
          view.setMediaStream(null);
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
    this.mediaFrames.setSource(
      mediaTrack,
      this.microphone
    );
    this.hasCapturedFrame = false;
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
        this.mediaFrames.setSource(undefined);
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
