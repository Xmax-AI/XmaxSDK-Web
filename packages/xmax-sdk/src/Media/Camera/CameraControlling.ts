//
//  CameraControlling.ts
//  XmaxSDK
//
//  Author: 翁跃庭 (Yueting Weng)
//  GitHub: https://github.com/Xmax-AI/XmaxSDK-Web
//
//  Copyright (c) 2026 XMAX.AI PTE. LTD.
//

import type { CreateLocalCameraStreamOptions } from "../../Service/Realtime/CreateLocalCameraStreamOptions";
import type { RealtimeCamera } from "../../Service/Realtime/RealtimeCamera";
import type { RealtimeMediaFrameListener } from "../../Service/Realtime/RealtimeMediaFrame";
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
 * Capture options with the video format resolved by Core.
 */
export type CameraStreamOptions = Omit<CreateLocalCameraStreamOptions, "videoFormat" | "camera"> & {
  videoFormat: RealtimeVideoFormat;
  camera: RealtimeCamera;
};

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
   * The camera warmup before publication, in milliseconds.
   */
  readonly warmupMs: number;

  /**
   * Observes captured camera and microphone frames.
   */
  setLocalMediaFrameListener(
    listener?: RealtimeMediaFrameListener
  ): Promise<void>;

  /**
   * Waits for camera warmup, rejecting cancellation or track replacement.
   */
  waitForCameraWarmup(
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
   * @throws Rejects for active capture, invalid settings, denied permission, or capture-start failure.
   */
  createLocalCameraStream(
    options: CameraStreamOptions,
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
