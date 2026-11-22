//
//  RtcManaging.ts
//  XmaxSDK
//
//  Author: 翁跃庭 (Yueting Weng)
//  GitHub: https://github.com/Xmax-AI/XmaxSDK-Web
//
//  Copyright (c) 2026 XMAX.AI PTE. LTD.
//

import type { RtcEventListener } from "./RtcEventListener";
import type { RtcRoomJoinConfiguration } from "./RoomJoinConfiguration";
import type { VideoEncodingConfiguration } from "./VideoEncodingConfiguration";

/**
 * Message delivery policies: ordered awaits each result; latest replaces unsent snapshots; barrier also
 * discards earlier unsent snapshots. Concurrent commands retain every send without serially waiting
 * for native acknowledgements; service-level receipt is handled by the room layer.
 */
export type RtcRoomMessageDelivery = "ordered" | "latest" | "barrier" | "concurrent";

/** Tracks owned by the media source and supplied to an RTC adapter for publication. */
export interface RtcLocalMediaTracks {
  videoTrack: MediaStreamTrack;
  audioTrack?: MediaStreamTrack;
  /** Identifies camera media for provider-specific audio profiles and video track replacement. */
  source?: "camera";
}

/**
 * The RTC engine, room, media-transport, and messaging capabilities. The media layer owns capture
 * and supplies tracks for RTC publication.
 */
export interface RtcManaging {

  /**
   * Whether the RTC engine is initialized.
   */
  readonly isInitialized: boolean;

  /**
   * Initializes the engine independently of room credentials and device capture.
   */
  initialize(): Promise<void>;

  /**
   * Destroys the engine and releases its resources.
   */
  destroy(): Promise<void>;

  /**
   * Prepares clones of the supplied tracks without publishing. The adapter releases the clones
   * on destruction. Audio is optional and comes from the supplied track.
   */
  setExternalMediaTracks(tracks: RtcLocalMediaTracks): Promise<void>;

  /** Replaces the published SDK camera track, retaining the current room and encoding configuration. */
  replaceCameraVideoTrack(track: MediaStreamTrack): Promise<void>;

  /**
   * Configures uplink video encoding on the provider's local track.
   *
   * @throws Rejects if no video track is prepared or encoding configuration fails.
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
   * Leaves the current RTC room and cancels pending room entry.
   */
  leaveRoom(): Promise<void>;

  /**
   * Publishes local video.
   *
   * @throws Rejects if no video track is prepared or publication fails.
   */
  publishLocalVideo(): Promise<void>;

  /**
   * Unpublishes local video while retaining capture and local preview.
   */
  unpublishLocalVideo(): Promise<void>;

  /**
   * Publishes the prepared audio track when supplied.
   *
   * @throws Rejects if publication fails.
   */
  publishLocalAudio(): Promise<void>;

  /**
   * Unpublishes local audio while retaining the prepared track.
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
   * @param signal - Cancels unsent work and completion waits; already transmitted data cannot be recalled.
   * @throws Rejects if no room is joined or the message is oversized.
   */
  sendRoomMessage(
    message: string,
    delivery?: RtcRoomMessageDelivery,
    signal?: AbortSignal,
  ): Promise<void>;

  /**
   * Sets the RTC event listener; undefined removes it.
   */
  setEventListener(
    listener?: RtcEventListener
  ): void;
}
