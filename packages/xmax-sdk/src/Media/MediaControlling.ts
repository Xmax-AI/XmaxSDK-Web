//
//  MediaControlling.ts
//  XmaxSDK
//
//  Author: 翁跃庭 (Yueting Weng)
//  GitHub: https://github.com/Xmax-AI/XmaxSDK-Web
//
//  Copyright (c) 2026 XMAX.AI PTE. LTD.
//

import type { CameraControlling, CameraPreviewReadyHandler } from "./Camera/CameraControlling";
import type { VideoController } from "./Video/VideoController";
import type { RealtimeExternalVideoStreamOptions } from "./External/RealtimeExternalVideoSource";
import type { ImageController } from "./Image/ImageController";
import type { InteractionControlling } from "./Interaction/InteractionControlling";
import type { RealtimeVideoTrack } from "../Service/Realtime/RealtimeVideoTrack";
import type { RealtimeMediaStream } from "../Service/Realtime/RealtimeMediaStream";
import type { RealtimeVideoFormat } from "../Service/Realtime/RealtimeVideoFormat";

/**
 * The unified media capability boundary, keeping internal source controllers hidden from Core.
 */
export interface MediaControlling extends InteractionControlling {

  /**
   * The active source's publishable video track.
   */
  readonly currentTrack?: RealtimeVideoTrack;

  /**
   * The active media source kind.
   */
  readonly source?: "camera" | "localVideo" | "localImage" | "externalVideo";

  /**
   * Whether the source provides publishable audio.
   */
  readonly hasAudio: boolean;

  /**
   * Whether camera publication waits for startup warmup.
   */
  readonly isFrameValidationEnabled: boolean;

  /**
   * Requires no active or preparing local source.
   */
  ensureNoLocalSource(): void;

  /**
   * Validates RTC support for external media input.
   */
  validateExternalMediaSupport(
    kind: "local" | "external" | "image"
  ): void;

  /**
   * Creates camera capture and preview.
   */
  createLocalCameraStream(
    options: Parameters<CameraControlling["createLocalCameraStream"]>[0]
  ): Promise<RealtimeMediaStream>;

  /**
   * Updates the camera format; other source kinds are unsupported.
   */
  updateCameraFormat(
    videoFormat: RealtimeVideoFormat
  ): Promise<void>;

  /**
   * Creates and unlocks file-video playback; prepareSource initializes RTC.
   */
  createLocalVideoStream(
    options: Parameters<VideoController["create"]>[0],
    signal: AbortSignal
  ): Promise<RealtimeMediaStream>;

  /**
   * Creates still-image video output; prepareSource initializes RTC.
   */
  createLocalImageStream(
    options: Parameters<ImageController["create"]>[0],
    signal: AbortSignal
  ): Promise<RealtimeMediaStream>;

  /**
   * Binds an external frame source or cloned track; prepareSource initializes RTC.
   */
  createExternalVideoStream(
    options: RealtimeExternalVideoStreamOptions,
    signal: AbortSignal
  ): Promise<RealtimeMediaStream>;

  /**
   * Schedules external audio only after publication and clears pending audio immediately on
   * disconnection.
   */
  setExternalAudioPublished(
    published: boolean
  ): void;

  /**
   * Prepares RTC and installs non-camera tracks, checking operation ownership at each asynchronous
   * boundary.
   */
  prepareSource(
    ensureCurrent: () => void
  ): Promise<void>;

  /**
   * Sets camera-preview readiness notification.
   */
  setCameraPreviewReadyHandler(
    handler?: CameraPreviewReadyHandler
  ): void;

  /**
   * Waits for camera warmup with connection cancellation.
   */
  waitForValidCameraFrame(
    signal: AbortSignal
  ): Promise<void>;

  /**
   * Switches camera capture without taking ownership of external devices.
   */
  switchCamera(): Promise<RealtimeMediaStream>;

  /**
   * Stops camera capture and releases its resources.
   */
  stopLocalCameraStream(): Promise<void>;

  /**
   * Starts local video playback after generation signaling.
   */
  startLocalVideo(
    signal: AbortSignal
  ): Promise<void>;

  /**
   * Pauses file playback while retaining local resources.
   */
  pauseLocalVideo(): void;

  /**
   * Releases the source and RTC, preserving local-track cleanup even when another release step fails.
   */
  stopLocalStream(): Promise<void>;
}
