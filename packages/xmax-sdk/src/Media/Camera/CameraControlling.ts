//
//  CameraControlling.ts
//  XmaxSDK
//
//  Author: 翁跃庭 (Yueting Weng)
//  GitHub: https://github.com/Xmax-AI/XmaxSDK-Web
//
//  Copyright (c) 2026 XMAX.AI PTE. LTD.
//

import type { CameraPosition } from "../../Foundation/Media/Camera/CameraPosition";
import type { CameraRotation } from "../../Foundation/Media/Camera/CameraRotation";
import type { RealtimeMediaStream } from "../../Service/Realtime/RealtimeMediaStream";
import type { RealtimeVideoFormat } from "../../Service/Realtime/RealtimeVideoFormat";
import type { RealtimeVideoTrack } from "../../Service/Realtime/RealtimeVideoTrack";

/**
 * Receives camera-preview readiness with a validity check for asynchronous handling.
 */
export type CameraPreviewReadyHandler = (
  isCurrent: () => boolean
) => void;

/**
 * Local camera, microphone configuration, and preview resource management.
 */
export interface CameraControlling {

  /**
   * The active local camera track; undefined before creation or after stop.
   */
  readonly currentTrack?: RealtimeVideoTrack;

  /**
   * Whether the current camera source requests microphone input.
   */
  readonly useMicrophone: boolean;

  /**
   * Whether pre-publication camera warmup is enabled.
   */
  readonly isFrameValidationEnabled: boolean;

  /**
   * Waits for the fixed 200 ms warmup, rejecting cancellation or track replacement.
   */
  waitForValidCameraFrame(
    signal: AbortSignal
  ): Promise<void>;

  /**
   * Sets one-shot readiness requiring a valid frame and an attached preview.
   */
  setPreviewReadyHandler(
    handler?: CameraPreviewReadyHandler
  ): void;

  /**
   * Creates and starts local camera media.
   *
   * @param options.videoFormat - The post-rotation format, resolved by model rules.
   * @param options.position - The camera position.
   * @param options.cameraDeviceId - The exact browser camera ID, if selected.
   * @param options.useMicrophone - Whether to capture and publish microphone audio.
   * @param options.microphoneDeviceId - The exact browser microphone ID, if selected.
   * @param options.rotation - Clockwise rotation; defaults to 0.
   * @param options.enableFrameValidation - Whether to wait for warmup; defaults to true and persists
   * across switching and reconnection.
   * @throws Rejects for active capture, invalid settings, denied permission, or capture-start failure.
   */
  createLocalCameraStream(
    options: {
      videoFormat: RealtimeVideoFormat;
      position: CameraPosition;
      cameraDeviceId?: string;
      useMicrophone: boolean;
      microphoneDeviceId?: string;
      rotation?: CameraRotation;
      enableFrameValidation?: boolean;
    },
    signal: AbortSignal
  ): Promise<RealtimeMediaStream>;

  /** Prepares SDK-owned camera and microphone tracks for the connection. */
  prepareForConnection(signal: AbortSignal): Promise<void>;

  /** Releases RTC track clones and the microphone while retaining the camera preview. */
  releaseConnectionMedia(): Promise<void>;

  /**
   * Stops camera and microphone capture and releases the track and local preview.
   */
  stopLocalCameraStream(): Promise<void>;

  /**
   * Updates camera dimensions, frame rate, and encoding metadata while retaining the SDK track and
   * preview binding.
   */
  updateVideoFormat(
    videoFormat: RealtimeVideoFormat,
    signal: AbortSignal
  ): Promise<void>;

  /**
   * Switches cameras while retaining the SDK track.
   *
   * @throws Rejects without active capture or if switching fails.
   */
  switchCamera(signal: AbortSignal): Promise<RealtimeMediaStream>;
}
