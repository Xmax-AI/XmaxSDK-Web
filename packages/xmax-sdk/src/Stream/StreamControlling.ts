//
//  StreamControlling.ts
//  XmaxSDK
//
//  Author: 翁跃庭 (Yueting Weng)
//  GitHub: https://github.com/Xmax-AI/XmaxSDK-Web
//
//  Copyright (c) 2026 XMAX.AI PTE. LTD.
//

import type { RemoteStream } from "../Foundation/RTC/RemoteStream";
import type { RealtimeNetworkQualityListener } from "../Foundation/RTC/NetworkStatistics";
import type { DownlinkVideoStatisticsListener, UplinkVideoStatisticsListener } from "../Foundation/RTC/VideoStatistics";
import type { RealtimeContext } from "../Service/Realtime/RealtimeContext";
import type { RealtimeExtraParams } from "../Service/Realtime/RealtimeExtraParams";
import type { RealtimePoint } from "../Service/Realtime/RealtimePoint";
import type { RtcSessionConnection } from "../Service/Realtime/RealtimeSessionConnection";
import type { RealtimeVideoFormat } from "../Service/Realtime/RealtimeVideoFormat";
import type { ModelSize } from "../Service/Realtime/RealtimeModel";
import type { RoomListener } from "./Room/RoomControlling";
import type { RoomEventTargetSize } from "./Room/RoomEvent";
import type { RemoteMediaTracks } from "../Foundation/Media/RemoteMediaTracks";

/**
 * A remote result stream and its renderable video track.
 */
export interface RemoteStreamBinding {

  /**
   * The remote stream identity.
   */
  stream: RemoteStream;

  /**
   * The remote video track.
   */
  videoTrack: MediaStreamTrack;
}

/**
 * Receives a ready result binding, or null when the binding is cleared.
 */
export type RemoteStreamListener = (
  binding: RemoteStreamBinding | null
) => void;

/**
 * Shared parameters for generation start and condition updates.
 */
export interface StreamGenerationOptions {

  /**
   * The unique generation task identifier.
   */
  taskID: string;

  /**
   * The server generation video format, independent of local media dimensions.
   */
  videoFormat: RealtimeVideoFormat;

  /**
   * The conditions used by the generation task.
   */
  context: RealtimeContext;

  /**
   * Replaces the running task on start; defaults to false and does not send stop first.
   */
  restart?: boolean;

  /**
   * The returned video dimensions, omitted when unset.
   */
  targetSize?: RoomEventTargetSize;

  /**
   * Whether the server mirrors the input on start; false for sources other than the front camera.
   */
  mirror?: boolean;

  /**
   * Whether to restore the original face on start and condition updates; defaults to false.
   */
  faceRestoration?: boolean;

  /**
   * Whether the server fits media inside the generation canvas using contain mode.
   */
  paddingContain?: boolean;

  /**
   * Runs after start is sent without waiting for confirmation; not called for condition updates.
   */
  onStartSent?: () => Promise<void>;

  /**
   * Parameters merged into this message without being retained.
   */
  extraParams?: RealtimeExtraParams;
}

/**
 * Defines the transport capabilities exposed to the Core layer.
 */
export interface StreamControlling {

  /**
   * Observes the active result tracks and audio-track changes; undefined clears the binding without
   * changing subscriptions or playback volume.
   */
  setRemoteMediaListener(
    listener?: (
      tracks?: RemoteMediaTracks
    ) => void
  ): void;

  /**
   * Observes network statistics; undefined clears the listener.
   */
  setNetworkQualityListener(
    listener?: RealtimeNetworkQualityListener
  ): void;

  /**
   * Whether a generation task is starting or running.
   */
  readonly hasGenerationTask: boolean;

  /**
   * The generated audio playback volume, from 0 to 1.
   */
  readonly remoteAudioVolume: number;

  /**
   * Sets the playback volume for all subscribed result audio.
   *
   * @param volume - The playback volume, from 0 to 1.
   */
  setRemoteAudioVolume(
    volume: number
  ): void;

  /**
   * Configures uplink encoding, including the bitrate range and policy.
   *
   * Encoding affects the sender, not capture; configure it before publishing local media.
   *
   * @throws Rejects if the format or bitrate range is invalid, or RTC configuration fails.
   */
  updateUplinkVideoFormat(
    videoFormat: RealtimeVideoFormat
  ): Promise<void>;

  /**
   * Updates only the uplink target frame rate, retaining the last successfully applied encoding
   * configuration.
   */
  updateUplinkFrameRate(
    fps: number
  ): Promise<RealtimeVideoFormat>;

  /**
   * Joins an RTC room and publishes local media.
   *
   * @param connection - The room, user, credentials, and result bot information.
   * @param includeLocalAudio - Whether to publish local audio with video.
   * @param ensureActive - Checks operation validity at asynchronous boundaries.
   * @param beforePublish - An optional media-readiness check before publication that does not block
   * joining.
   * @param measureRtcJoin - Measures only the RTC adapter join call, excluding room messaging
   * configuration and heartbeat startup.
   * @throws Rejects if canceled or joining, room configuration, or publication fails.
   */
  connect(
    connection: RtcSessionConnection,
    includeLocalAudio: boolean,
    ensureActive: () => void,
    beforePublish?: () => Promise<void>,
    measureRtcJoin?: () => () => void,
  ): Promise<void>;

  /**
   * Clears generation state, local publication, and remote subscriptions, then leaves the room.
   */
  disconnect(): Promise<void>;

  /**
   * Applies new credentials for the same session; the signal cancels pending recovery when disconnected.
   */
  updateCredentials(
    connection: RtcSessionConnection,
    signal?: AbortSignal
  ): Promise<void>;

  /**
   * Creates a generation task and sends its start message.
   *
   * @param options.taskID - The generation task identifier.
   * @param options.videoFormat - The generation video format.
   * @param options.context - The generation conditions.
   * @param options.restart - Replaces the running task while retaining the connection; defaults to false
   * and does not send stop first.
   * @param options.targetSize - The returned video dimensions, omitted when unset.
   * @param options.mirror - Whether the server mirrors the input; defaults to false.
   * @param options.faceRestoration - Whether to restore the original face; defaults to false.
   * @param options.onStartSent - Runs after start is sent, before generation confirmation.
   * @param options.extraParams - Parameters merged into this start message without being retained.
   * @returns A promise resolved after result video publication and subscription; it rejects on timeout,
   * cancellation, or subscription failure.
   * @throws Throws synchronously for an invalid task ID, an unready room, a pending start, or a running
   * task without restart. The returned promise rejects if sending fails or confirmation times out.
   */
  beginGeneration(
    options: StreamGenerationOptions
  ): Promise<void>;

  /**
   * Subscribes to the active result stream's audio after its first frame is displayable.
   *
   * @throws Rejects if generation is unconfirmed or RTC volume or subscription configuration fails.
   */
  activateRemoteAudio(): Promise<void>;

  /**
   * Sends updated generation conditions.
   *
   * @param options.taskID - The generation task identifier.
   * @param options.videoFormat - The generation video format.
   * @param options.context - The updated generation conditions.
   * @param options.restart - Unused for condition updates.
   * @param options.targetSize - The returned video dimensions, omitted when unset.
   * @param options.mirror - Unused for condition updates.
   * @param options.faceRestoration - Whether to restore the original face; defaults to false.
   * @param options.onStartSent - Not called for condition updates.
   * @param options.extraParams - Parameters merged into this change_condition message without being
   * retained.
   * @throws Rejects if the room is not ready or sending fails.
   */
  updateGeneration(
    options: StreamGenerationOptions
  ): Promise<void>;

  /**
   * Updates returned video dimensions without restarting generation.
   *
   * @throws Rejects if the operation is canceled, the room is not ready, or sending fails.
   */
  updateDownlinkVideoResolution(
    taskID: string,
    targetSize: ModelSize,
    ensureActive: () => void,
  ): Promise<void>;

  /**
   * Stops generation and clears its result stream; an empty identifier stops the current task.
   *
   * @throws Rejects if the stop message cannot be sent.
   */
  stopGeneration(
    taskID: string
  ): Promise<void>;

  /**
   * Sends interaction points; ignores an empty point list.
   *
   * @throws Rejects if the room is not ready or sending fails.
   */
  sendTracks(
    taskID: string,
    points: RealtimePoint[]
  ): Promise<void>;

  /**
   * Sets the room message listener; an undefined value clears it.
   */
  setRoomListener(
    listener?: RoomListener
  ): void;

  /**
   * Sets the uplink video statistics listener; undefined clears it.
   */
  setUplinkVideoStatisticsListener(
    listener?: UplinkVideoStatisticsListener
  ): void;

  /**
   * Observes statistics for the accepted result publisher.
   */
  setDownlinkVideoStatisticsListener(
    listener?: DownlinkVideoStatisticsListener
  ): void;
}
