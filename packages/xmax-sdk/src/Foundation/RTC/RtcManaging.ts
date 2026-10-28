//
//  RtcManaging.ts
//  XmaxSDK
//
//  Author: 翁跃庭 (Yueting Weng)
//  GitHub: https://github.com/Xmax-AI/XmaxSDK-Web
//
//  Copyright (c) 2026 XMAX.AI PTE. LTD.
//

import type { CameraPosition } from "../Media/Camera/CameraPosition";
import type { CameraRotation } from "../Media/Camera/CameraRotation";
import type { RtcEventListener } from "./RtcEventListener";
import type { RtcRoomJoinConfiguration } from "./RoomJoinConfiguration";
import type { VideoEncodingConfiguration } from "./VideoEncodingConfiguration";

/**
 * Message delivery policies: ordered awaits each result; latest replaces unsent snapshots; barrier also
 * discards earlier unsent snapshots.
 */
export type RtcRoomMessageDelivery = "ordered" | "latest" | "barrier";

/**
 * Camera capture settings.
 */
export interface RtcCameraCaptureOptions {

  /**
   * The requested capture width after model sizing, in pixels.
   */
  width: number;

  /**
   * The requested capture height, in pixels.
   */
  height: number;

  /**
   * The requested capture frame rate.
   */
  frameRate: number;

  /**
   * The initial camera position.
   */
  position: CameraPosition;

  /**
   * Clockwise input rotation; dimensions describe the rotated output. Defaults to 0.
   */
  rotation?: CameraRotation;
}

/**
 * The RTC engine, room, media-transport, and messaging capabilities. Capture does not publish media;
 * local tracks are published only when connecting.
 */
export interface RtcManaging {

  /**
   * Whether the RTC engine is initialized.
   */
  readonly isInitialized: boolean;

  /**
   * Initializes the engine without requiring credentials, including during local preview.
   */
  initialize(): Promise<void>;

  /**
   * Destroys the engine and releases its resources.
   */
  destroy(): Promise<void>;

  /**
   * Starts camera capture without publishing.
   *
   * @returns The captured video track.
   * @throws Rejects if the engine is uninitialized, the device is unavailable, or permission is denied.
   */
  startCameraCapture(
    options: RtcCameraCaptureOptions
  ): Promise<MediaStreamTrack>;

  /**
   * Updates preview capture settings and returns the native output track without switching devices or
   * publishing.
   */
  updateCameraCapture?(
    options: RtcCameraCaptureOptions
  ): Promise<MediaStreamTrack>;

  /**
   * Switches between front and rear cameras.
   *
   * @returns The replacement capture track.
   * @throws Rejects if capture has not started or switching fails.
   */
  switchCameraCapture(
    to: CameraPosition
  ): Promise<MediaStreamTrack>;

  /**
   * Stops camera capture.
   */
  stopCameraCapture(): Promise<void>;

  /**
   * Prepares external audio/video tracks without publication, retaining clones while the media source
   * owns the originals. Unsupported providers omit this capability; missing external audio must not fall
   * back to microphone capture.
   */
  setExternalMediaTracks?(
    tracks: {
      videoTrack: MediaStreamTrack;
      audioTrack?: MediaStreamTrack;
    }
  ): Promise<void>;

  /**
   * Configures uplink video encoding independently of capture.
   *
   * @throws Rejects if capture has not started or encoding configuration fails.
   */
  configureVideoEncoding(
    configuration: VideoEncodingConfiguration,
  ): Promise<void>;

  /**
   * Joins an RTC room.
   *
   * @throws Rejects if the engine is uninitialized, join parameters are invalid, or joining fails.
   */
  joinRoom(
    configuration: RtcRoomJoinConfiguration
  ): Promise<void>;

  /**
   * Applies refreshed credentials without changing the room or provider; cancellation interrupts
   * credential recovery.
   */
  updateCredentials(
    configuration: RtcRoomJoinConfiguration,
    signal?: AbortSignal
  ): Promise<void>;

  /**
   * Leaves the current RTC room, doing nothing when no room is joined.
   */
  leaveRoom(): Promise<void>;

  /**
   * Publishes local video.
   *
   * @throws Rejects if capture has not started or publication fails.
   */
  publishLocalVideo(): Promise<void>;

  /**
   * Unpublishes local video while retaining capture and local preview.
   */
  unpublishLocalVideo(): Promise<void>;

  /**
   * Publishes local audio, starting microphone capture on first use when applicable.
   *
   * @throws Rejects for denied microphone permission or publication failure.
   */
  publishLocalAudio(): Promise<void>;

  /**
   * Unpublishes local audio while retaining microphone capture.
   */
  unpublishLocalAudio(): Promise<void>;

  /**
   * Changes a remote main-video subscription.
   *
   * @returns The subscribed video track, or undefined after unsubscription.
   * @throws Rejects if subscription or unsubscription fails.
   */
  subscribeRemoteVideo(
    userID: string,
    subscribe: boolean,
  ): Promise<MediaStreamTrack | undefined>;

  /**
   * Changes a remote audio subscription.
   *
   * @throws Rejects if the operation fails.
   */
  subscribeRemoteAudio(
    userID: string,
    subscribe: boolean
  ): Promise<void>;

  /**
   * Returns the remote audio track before playback volume processing, or undefined before audio
   * subscription. Throws when independent audio observation and muted playback are unsupported.
   */
  getRemoteAudioTrack(
    userID: string
  ): MediaStreamTrack | undefined;

  /**
   * Whether the adapter supports independent remote-volume control. Unsupported platforms may use binary
   * playback/mute and require volume reapplication after subscription.
   */
  readonly supportsRemoteAudioVolumeControl: boolean;

  /**
   * Sets a remote user's audio playback volume.
   *
   * @param volume - The volume, from 0 to 100.
   */
  setRemoteAudioVolume(
    volume: number,
    userID: string
  ): void;

  /**
   * Sends a room text message; TRTC uses cmdId 1.
   *
   * @param message - UTF-8 text subject to the adapter's byte limit.
   * @param delivery - The ordering and replacement policy. Latest may return after enqueueing, without
   * confirming remote receipt.
   * @throws Rejects if no room is joined or the message is oversized.
   */
  sendRoomMessage(
    message: string,
    delivery?: RtcRoomMessageDelivery,
  ): Promise<void>;

  /**
   * Sets the RTC event listener; undefined removes it.
   */
  setEventListener(
    listener?: RtcEventListener
  ): void;
}
