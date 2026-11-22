//
//  AgoraRtcManager.ts
//  XmaxSDK
//
//  Author: 翁跃庭 (Yueting Weng)
//  GitHub: https://github.com/Xmax-AI/XmaxSDK-Web
//
//  Copyright (c) 2026 XMAX.AI PTE. LTD.
//

import { RtcProvider } from "../RtcProvider";
import type {
  AREAS,
  IAgoraRTC,
  IAgoraRTCClient,
  IAgoraRTCRemoteUser,
  ILocalVideoTrack,
  ILocalAudioTrack,
  VideoEncoderConfiguration
} from "agora-rtc-sdk-ng";
import { XmaxError, XmaxErrorCode } from "../../Errors/XmaxError";
import { XmaxLogger } from "../../Logging/XmaxLogger";
import { XmaxEnvironment } from "../../../Core/XmaxEnvironment";
import type { RtcManaging, RtcLocalMediaTracks, RtcRoomMessageDelivery } from "../RtcManaging";
import type { RtcEventListener } from "../RtcEventListener";
import type { RtcRoomJoinConfiguration, AgoraRoomJoinConfiguration } from "../RoomJoinConfiguration";
import { RtcVideoEncoderPreference, type VideoEncodingConfiguration } from "../VideoEncodingConfiguration";
import { AgoraRtcStatistics } from "./AgoraRtcStatistics";

/**
 * The pinned Agora SDK's DataStream extension, absent from its public client type.
 */
export interface AgoraDataStreamClient extends IAgoraRTCClient {

  /**
   * Sends UTF-8 room text with native retry disabled so the operation owns failure handling.
   */
  sendStreamMessage(
    message: string,
    needRetry: boolean
  ): Promise<void>;
}

/**
 * A room-bound pending message; controls carry completion callbacks while snapshots retain only the
 * latest unsent value.
 */
interface PendingRoomMessage {

  /**
   * The client that owned the message when it was created.
   */
  client: AgoraDataStreamClient;

  /**
   * The room revision used to reject messages from an obsolete connection.
   */
  version: number;

  /**
   * The message text.
   */
  message: string;

  /**
   * Whether other queued messages may be submitted before this native result arrives.
   */
  concurrent?: boolean;

  /**
   * Cancels obsolete commands before submission or while awaiting a native result.
   */
  signal?: AbortSignal;

  /**
   * The control-message completion callbacks; snapshot enqueueing does not await gateway acknowledgment.
   */
  completion?: {
    resolve: () => void;
    reject: (
      error: unknown
    ) => void;
  };
}

/**
 * Agora service environment and lazy module-loading configuration.
 */
export interface AgoraRtcManagerOptions {

  /**
   * The service environment selecting the provider region.
   */
  environment: XmaxEnvironment;

  /**
   * The loader invoked on first initialization.
   */
  loadSDK?: () => Promise<IAgoraRTC>;
}

/**
 * An Agora media, room, and DataStream adapter with instance-owned clients and tracks.
 */
export class AgoraRtcManager implements RtcManaging {

  /**
   * Module-wide region references. Because setArea is global, conflicting active environments are
   * rejected.
   */
  private static readonly regions = new Map<IAgoraRTC, {
    environment: XmaxEnvironment;
    count: number
  }>();

  /**
   * The configured service environment.
   */
  private readonly environment: XmaxEnvironment;

  /**
   * The lazy Agora runtime loader.
   */
  private readonly loadSDK: () => Promise<IAgoraRTC>;

  /**
   * The loaded Agora SDK module.
   */
  private sdk?: IAgoraRTC;

  /**
   * The current Agora client.
   */
  private client?: AgoraDataStreamClient;

  /**
   * The shared initialization promise preventing duplicate clients.
   */
  private initialization?: Promise<void>;

  /**
   * The lifecycle revision invalidating work after destruction.
   */
  private lifecycle = 0;

  /**
   * The external-video clone owned by this adapter.
   */
  private externalVideo?: ILocalVideoTrack;

  /** Whether the external video is owned by the SDK camera controller. */
  private externalCamera = false;

  /**
   * The external-audio clone owned by this adapter.
   */
  private externalAudio?: ILocalAudioTrack;

  /**
   * The last encoding preference applied to each local video track.
   */
  private readonly appliedOptimizationModes = new WeakMap<ILocalVideoTrack, RtcVideoEncoderPreference>();

  /**
   * The encoder profile to reapply when the SDK replaces the camera input.
   */
  private externalCameraEncoding?: VideoEncoderConfiguration;

  /**
   * Serializes encoder updates with SDK camera input replacement.
   */
  private videoUpdateTail: Promise<void> = Promise.resolve();

  /**
   * The active room identity and credentials.
   */
  private connection?: AgoraRoomJoinConfiguration;

  /**
   * The room revision invalidating work after leaving.
   */
  private roomVersion = 0;

  /**
   * Whether credentials have expired and room recovery is required.
   */
  private tokenExpired = false;

  /**
   * The shared room-recovery operation.
   */
  private rejoinOperation?: Promise<void>;

  /**
   * The shared underlying rejoin task.
   */
  private rejoinTask?: Promise<void>;

  /**
   * The callback cancelling the current rejoin wait.
   */
  private cancelRejoin?: () => void;

  /**
   * Whether the app currently requests video publication.
   */
  private videoPublishRequested = false;

  /**
   * Whether the app currently requests audio publication.
   */
  private audioPublishRequested = false;

  /**
   * The shared RTC event listener.
   */
  private listener?: RtcEventListener;

  /**
   * The periodic statistics timer.
   */
  private statisticsTimer?: ReturnType<typeof setInterval>;

  /**
   * Whether network sampling is suspended during recovery or exit.
   */
  private networkQualitySuspended = false;

  /**
   * Per-user playback volumes, from 0 to 100.
   */
  private readonly audioVolumes = new Map<string, number>();

  /**
   * The remote users for which audio subscription is requested.
   */
  private readonly requestedAudio = new Set<string>();

  /**
   * The ordered control queue, prioritized over unsent interaction snapshots.
   */
  private readonly orderedMessages: PendingRoomMessage[] = [];

  /**
   * The latest snapshot not yet submitted to Agora.
   */
  private latestMessage?: PendingRoomMessage;

  /**
   * The identity isolating asynchronous work for the current message-drain loop.
   */
  private messageDrain?: object;

  /**
   * Cancellation callbacks for in-flight gateway responses; at most 30 snapshot sends may remain
   * pending.
   */
  private readonly activeSends = new Set<() => void>();

  /**
   * Creates an adapter without loading browser dependencies or requesting device permission.
   */
  constructor(
    options: AgoraRtcManagerOptions
  ) {
    this.environment = options.environment;
    this.loadSDK = options.loadSDK ?? (async () => (await import("agora-rtc-sdk-ng")).default);
  }

  /**
   * Whether this instance has an Agora client.
   */
  get isInitialized(): boolean {
    return this.client !== undefined;
  }

  /**
   * Whether independent volume control is supported. Zero volume additionally stops playback.
   */
  get supportsRemoteAudioVolumeControl(): boolean {
    return true;
  }

  /**
   * Initializes one client per instance using the configured service region.
   */
  async initialize(): Promise<void> {
    if (this.client) {
      return;
    }
    if (this.initialization) {
      return this.initialization;
    }

    const version = this.lifecycle;
    const operation = this.performInitialize(version);
    this.initialization = operation;
    try {
      await operation;
    } finally {
      if (this.initialization === operation) {
        this.initialization = undefined;
      }
    }
  }

  /**
   * Loads the SDK, reserves its region, and registers events without reviving destroyed instances.
   */
  private async performInitialize(
    version: number
  ): Promise<void> {
    const sdk = await this.loadSDK();
    if (version !== this.lifecycle) {
      throw this.cancelled();
    }

    const region = AgoraRtcManager.regions.get(sdk);
    if (region && region.environment !== this.environment) {
      throw new XmaxError(
        XmaxErrorCode.invalidConfiguration,
        "Concurrent Agora clients must use the same XmaxEnvironment"
      );
    }
    sdk.setLogLevel(4);
    if (!region) {
      sdk.setArea([(this.environment === XmaxEnvironment.china ? "CHINA" : "GLOBAL") as AREAS]);
    }

    const client = sdk.createClient({
      mode: "rtc",
      codec: "h264"
    }) as AgoraDataStreamClient;
    if (typeof client.sendStreamMessage !== "function") {
      throw new XmaxError(
        XmaxErrorCode.rtcError,
        "Agora DataStream is unavailable in this SDK version"
      );
    }
    AgoraRtcManager.regions.set(
      sdk,
      {
        environment: this.environment,
        count: (region?.count ?? 0) + 1
      }
    );
    this.sdk = sdk;
    this.client = client;
    this.registerEvents(client);
  }

  /**
   * Invalidates asynchronous work before releasing room, local tracks, events, and the SDK region.
   */
  async destroy(): Promise<void> {
    this.lifecycle++;
    const client = this.client;
    // Retain the app listener for reuse after close; remove callbacks from the obsolete client separately.
    this.clearRoom();
    this.client = undefined;
    client?.removeAllListeners();
    this.externalVideo?.close();
    this.externalAudio?.close();
    this.externalVideo = undefined;
    this.externalCamera = false;
    this.externalCameraEncoding = undefined;
    this.videoUpdateTail = Promise.resolve();
    this.externalAudio = undefined;

    const sdk = this.sdk;
    this.sdk = undefined;
    try {
      await client?.leave();
    } catch {
      XmaxLogger.rtc.warning(() => "Agora 退房失败，已释放本地资源 (Agora Leave Failed)");
    } finally {
      const region = sdk && AgoraRtcManager.regions.get(sdk);
      if (sdk && region && --region.count === 0) {
        AgoraRtcManager.regions.delete(sdk);
      }
    }
  }

  /**
   * Wraps cloned external tracks as Agora local tracks without device access, releasing clones on
   * failure.
   */
  async setExternalMediaTracks(
    tracks: RtcLocalMediaTracks
  ): Promise<void> {
    this.requireClient();
    if (this.externalVideo) {
      throw new XmaxError(
        XmaxErrorCode.invalidConfiguration,
        "Release the current local media before attaching external tracks"
      );
    }
    if (tracks.videoTrack.kind !== "video" || tracks.videoTrack.readyState !== "live" ||
      (tracks.audioTrack && (tracks.audioTrack.kind !== "audio" || tracks.audioTrack.readyState !== "live"))) {
      throw new XmaxError(
        XmaxErrorCode.invalidConfiguration,
        "External media requires live video and optional audio tracks"
      );
    }

    const video = tracks.videoTrack.clone();
    let audio: MediaStreamTrack | undefined;
    let wrappedVideo: ILocalVideoTrack | undefined;
    let wrappedAudio: ILocalAudioTrack | undefined;
    try {
      audio = tracks.audioTrack?.clone();
      wrappedVideo = this.sdk!.createCustomVideoTrack({ mediaStreamTrack: video });
      if (audio) {
        wrappedAudio = this.sdk!.createCustomAudioTrack({
          mediaStreamTrack: audio,
          encoderConfig: tracks.source === "camera" ? "speech_standard" : "music_standard"
        });
      }
      this.externalVideo = wrappedVideo;
      this.externalAudio = wrappedAudio;
      this.externalCamera = tracks.source === "camera";
    } catch (error) {
      wrappedVideo?.close();
      wrappedAudio?.close();
      video.stop();
      audio?.stop();
      throw this.mapError(error);
    }
  }

  /** Replaces SDK camera input on the existing Agora track and reapplies its encoder profile. */
  async replaceCameraVideoTrack(track: MediaStreamTrack): Promise<void> {
    const camera = this.externalCamera ? this.externalVideo : undefined;
    if (!camera) {
      throw new XmaxError(XmaxErrorCode.invalidConfiguration, "SDK camera is not prepared for publication");
    }
    await this.run(() => this.queueVideoUpdate(async () => {
      if (this.externalVideo !== camera) {
        throw this.cancelled();
      }
      const replacement = track.clone();
      try {
        await camera.replaceTrack(replacement, true);
        if (this.externalVideo !== camera) {
          throw this.cancelled();
        }
      } catch (error) {
        replacement.stop();
        throw error;
      }
      if (this.externalCameraEncoding) {
        // The replacement is already active. Keep it attached if Agora rejects reapplying the profile.
        try {
          await camera.setEncoderConfiguration(this.externalCameraEncoding);
        } catch {
          XmaxLogger.rtc.warning(() => "Agora 编码配置恢复失败 (Agora Encoder Configuration Restore Failed)");
        }
      }
    }));
  }

  /**
   * Applies the encoder configuration to the Agora track used for publication.
   */
  async configureVideoEncoding(
    config: VideoEncodingConfiguration
  ): Promise<void> {
    const video = this.requireLocalVideo();
    const client = this.requireClient();
    const version = this.roomVersion;
    const published = this.videoPublishRequested;
    const ensureActive = () => {
      if (this.externalVideo !== video || this.client !== client || this.roomVersion !== version ||
        (published && !this.videoPublishRequested)) {
        throw this.cancelled();
      }
    };
    const encoding: VideoEncoderConfiguration = {
      width: config.width,
      height: config.height,
      frameRate: config.frameRate,
      bitrateMin: config.minimumBitrate,
      bitrateMax: config.maximumBitrate,
    };
    await this.run(() => this.queueVideoUpdate(async () => {
      ensureActive();
      await video.setEncoderConfiguration(encoding);
      ensureActive();
      if (this.appliedOptimizationModes.get(video) !== config.encoderPreference) {
        await video.setOptimizationMode(
          config.encoderPreference === RtcVideoEncoderPreference.maintainFramerate ? "motion" : "detail"
        );
        ensureActive();
        this.appliedOptimizationModes.set(
          video,
          config.encoderPreference
        );
      }
      if (this.externalCamera) {
        this.externalCameraEncoding = encoding;
      }
    }));
  }

  /**
   * Serializes operations that change the active Agora video track or its encoder.
   */
  private queueVideoUpdate(
    operation: () => Promise<void>
  ): Promise<void> {
    const next = this.videoUpdateTail.then(operation);
    this.videoUpdateTail = next.catch(() => {});
    return next;
  }

  /**
   * Joins with the session's string channel and UID, using the configured region.
   */
  async joinRoom(
    configuration: RtcRoomJoinConfiguration
  ): Promise<void> {
    // Await obsolete rejoin cleanup before joining again so its late leave cannot disconnect a new room.
    await this.rejoinTask?.catch(() => { });
    const client = this.requireClient();
    if (configuration.provider !== RtcProvider.agora || this.connection) {
      throw new XmaxError(
        XmaxErrorCode.invalidConfiguration,
        "Agora credentials and an idle room are required"
      );
    }
    const version = ++this.roomVersion;
    await this.joinChannel(
      client,
      configuration
    );
    if (client !== this.client || version !== this.roomVersion) {
      await client.leave();
      throw this.cancelled();
    }

    this.connection = configuration;
    // Replay current publishers after joining because publication events may arrive before join resolves.
    for (const user of client.remoteUsers) {
      if (user.hasVideo) {
        this.listener?.onRemoteVideoPublished(
          String(user.uid),
          true
        );
      }
    }
    this.statisticsTimer = setInterval(
      () => {
        if (this.client !== client || !this.connection || this.tokenExpired || this.rejoinOperation) {
          return;
        }
        try {
          AgoraRtcStatistics.collect(
            client,
            this.listener
          );
        }
        catch {
          XmaxLogger.rtc.warning(() => "Agora 统计采样失败 (Agora Statistics Failed)");
        }
      },
      2000
    );
  }

  /**
   * Joins the native channel using the session's RTC credentials.
   */
  private async joinChannel(
    client: AgoraDataStreamClient,
    configuration: AgoraRoomJoinConfiguration
  ): Promise<void> {
    await this.run(() => client.join(
      configuration.appID,
      configuration.roomID,
      configuration.roomToken,
      configuration.userID
    ));
  }

  /**
   * Cancels messages, statistics, and playback before leaving while preserving local preview.
   */
  async leaveRoom(): Promise<void> {
    this.clearRoom();
    if (this.client) {
      await this.run(() => this.client!.leave());
    }
  }

  /**
   * Applies a new token to the same channel, renewing before expiration or rejoining and restoring media
   * afterward.
   */
  async updateCredentials(
    config: RtcRoomJoinConfiguration,
    signal?: AbortSignal
  ): Promise<void> {
    if (signal?.aborted) {
      throw this.cancelled();
    }
    const current = this.connection;
    const client = this.requireClient();
    if (
      !current || config.provider !== RtcProvider.agora ||
      config.appID !== current.appID || config.roomID !== current.roomID || config.userID !== current.userID
    ) {
      throw new XmaxError(
        XmaxErrorCode.sessionError,
        "Agora session binding changed"
      );
    }
    const version = this.roomVersion;
    if (!this.tokenExpired) {
      try {
        await this.run(() => client.renewToken(config.roomToken));
      } catch (error) {
        // Expiration during renewal requires rejoining rather than another renewToken call.
        this.ensureRoomCurrent(
          client,
          version
        );
        if (!this.tokenExpired) {
          throw error;
        }
      }
    }
    this.ensureRoomCurrent(
      client,
      version
    );
    if (signal?.aborted) {
      throw this.cancelled();
    }

    if (this.tokenExpired) {
      await this.rejoinRoom(
        client,
        config,
        signal
      );
    }
    else {
      this.connection = config;
    }
  }

  /**
   * Serializes same-room recovery without creating a session or resending generation start.
   */
  private async rejoinRoom(
    client: AgoraDataStreamClient,
    config: AgoraRoomJoinConfiguration,
    signal?: AbortSignal
  ): Promise<void> {
    if (this.rejoinOperation) {
      return this.rejoinOperation;
    }

    const version = ++this.roomVersion;
    const task = Promise.resolve().then(() => this.performRejoin(
      client,
      config,
      version
    ));
    this.rejoinTask = task;
    void task.finally(() => {
      if (this.rejoinTask === task) {
        this.rejoinTask = undefined;
      }
    }).catch(() => { });

    // Cancellation releases the caller immediately; the underlying task still cleans up a late successful join.
    let cancel!: () => void;
    const operation = new Promise<void>((
      resolve,
      reject
    ) => {
      cancel = () => {
        if (this.isRoomCurrent(
          client,
          version
        )) {
          this.roomVersion++;
        }
        reject(this.cancelled());
      };
      this.cancelRejoin = cancel;
      signal?.addEventListener(
        "abort",
        cancel,
        { once: true }
      );
      task.then(
        resolve,
        reject
      );
      if (signal?.aborted) {
        cancel();
      }
    });
    this.rejoinOperation = operation;
    try {
      await operation;
    } finally {
      signal?.removeEventListener(
        "abort",
        cancel
      );
      if (this.cancelRejoin === cancel) {
        this.cancelRejoin = undefined;
      }
      if (this.rejoinOperation === operation) {
        this.rejoinOperation = undefined;
      }
    }

    this.ensureRoomCurrent(
      client,
      version
    );
    for (const user of client.remoteUsers) {
      if (user.hasVideo) {
        this.listener?.onRemoteVideoPublished(
          String(user.uid),
          true
        );
      }
    }
  }

  /**
   * Rejoins with updated credentials, restoring local publication and remote audio subscriptions.
   */
  private async performRejoin(
    client: AgoraDataStreamClient,
    config: AgoraRoomJoinConfiguration,
    version: number
  ): Promise<void> {
    this.ensureRoomCurrent(
      client,
      version
    );
    for (const cancel of this.activeSends) {
      cancel();
    }
    this.listener?.onRoomRejoining?.();
    for (const user of client.remoteUsers) {
      user.audioTrack?.stop();
    }

    await this.run(() => client.leave());
    this.ensureRoomCurrent(
      client,
      version
    );
    await this.joinChannel(
      client,
      config
    );
    if (!this.isRoomCurrent(
      client,
      version
    )) {
      // A join completing after leave or destroy must release the connection it just created.
      await this.run(() => client.leave());
      throw this.cancelled();
    }

    const video = this.externalVideo;
    const audio = this.externalAudio;
    if (this.videoPublishRequested && video) {
      await this.run(() => client.publish(video));
      this.ensureRoomCurrent(
        client,
        version
      );
    }
    if (this.audioPublishRequested && audio) {
      await this.run(() => client.publish(audio));
      this.ensureRoomCurrent(
        client,
        version
      );
    }

    for (const user of client.remoteUsers) {
      if (!user.hasAudio || !this.requestedAudio.has(String(user.uid))) {
        continue;
      }
      const track = await this.run(() => client.subscribe(
        user,
        "audio"
      ));
      if (!this.isRoomCurrent(
        client,
        version
      )) {
        track.stop();
        throw this.cancelled();
      }
      // Use current volume and subscription intent because the app may mute or stop generation during recovery.
      this.applyAudioVolume(user);
    }

    this.connection = config;
    this.tokenExpired = false;
  }

  /**
   * Publishes the prepared local video track.
   */
  async publishLocalVideo(): Promise<void> {
    const client = this.requireClient();
    const camera = this.requireLocalVideo();
    this.videoPublishRequested = true;
    await this.rejoinOperation;
    if (client !== this.client || !this.videoPublishRequested) {
      throw this.cancelled();
    }
    if (client.localTracks.includes(camera)) {
      return;
    }
    await this.run(() => client.publish(camera));
  }

  /**
   * Unpublishes video while retaining the prepared track.
   */
  async unpublishLocalVideo(): Promise<void> {
    this.videoPublishRequested = false;
    if (this.rejoinTask || this.tokenExpired) {
      return;
    }
    const video = this.externalVideo;
    if (this.client && video) {
      await this.run(() => this.client!.unpublish(video));
    }
  }

  /**
   * Publishes the supplied audio track and remembers its publication across room recovery.
   */
  async publishLocalAudio(): Promise<void> {
    const client = this.requireClient();
    const audio = this.externalAudio;
    if (!audio) {
      return;
    }
    this.audioPublishRequested = true;
    await this.rejoinOperation;
    if (client !== this.client || !this.audioPublishRequested) {
      throw this.cancelled();
    }
    if (!client.localTracks.includes(audio)) {
      await this.run(() => client.publish(audio));
    }
  }

  /**
   * Unpublishes audio while retaining the prepared track.
   */
  async unpublishLocalAudio(): Promise<void> {
    this.audioPublishRequested = false;
    if (this.rejoinTask || this.tokenExpired) {
      return;
    }
    const audio = this.externalAudio;
    if (this.client && audio) {
      await this.run(() => this.client!.unpublish(audio));
    }
  }

  /**
   * Subscribes to remote main video and returns its native track without creating another player.
   */
  async subscribeRemoteVideo(
    userID: string,
    subscribe: boolean
  ): Promise<MediaStreamTrack | undefined> {
    if (!subscribe && this.rejoinTask) {
      return;
    }
    await this.rejoinOperation;
    const client = this.requireClient();
    const user = client.remoteUsers.find(user => String(user.uid) === userID);
    if (!user && !subscribe) {
      return;
    }
    if (!user) {
      throw new XmaxError(
        XmaxErrorCode.rtcError,
        "Agora remote video user is unavailable"
      );
    }
    if (!subscribe) {
      await this.run(() => client.unsubscribe(
        user,
        "video"
      ));
      return;
    }

    const version = this.roomVersion;
    const track = await this.run(() => client.subscribe(
      user,
      "video"
    ));
    if (client !== this.client || version !== this.roomVersion) {
      throw this.cancelled();
    }
    return track.getMediaStreamTrack();
  }

  /**
   * Remembers audio-subscription intent for later publication and applies volume before playback.
   */
  async subscribeRemoteAudio(
    userID: string,
    subscribe: boolean
  ): Promise<void> {
    const client = this.requireClient();
    const user = client.remoteUsers.find(user => String(user.uid) === userID);
    if (!subscribe) {
      this.requestedAudio.delete(userID);
      user?.audioTrack?.stop();
      if (user?.audioTrack && !this.rejoinTask) {
        await this.run(() => client.unsubscribe(
          user,
          "audio"
        ));
      }
      return;
    }
    this.requestedAudio.add(userID);
    if (this.rejoinOperation) {
      const version = this.roomVersion;
      await this.rejoinOperation;
      this.ensureRoomCurrent(
        client,
        version
      );
      if (this.requestedAudio.has(userID)) {
        await this.subscribeRemoteAudio(
          userID,
          true
        );
      }
      return;
    }
    if (!user?.hasAudio) {
      return;
    }

    const version = this.roomVersion;
    const track = await this.run(() => client.subscribe(
      user,
      "audio"
    ));
    if (client !== this.client || version !== this.roomVersion || !this.requestedAudio.has(userID)) {
      track.stop();
      return;
    }
    this.applyAudioVolume(user);
    this.listener?.onRemoteAudioTrackChanged?.(userID);
  }

  /**
   * Caches volume before subscription; zero avoids play() to prevent an initial audio leak.
   */
  setRemoteAudioVolume(
    volume: number,
    userID: string
  ): void {
    this.audioVolumes.set(
      userID,
      Math.max(0, Math.min(100, Number.isFinite(volume) ? Math.round(volume) : 0))
    );
    const user = this.client?.remoteUsers.find(user => String(user.uid) === userID);
    if (this.rejoinTask || this.tokenExpired) {
      user?.audioTrack?.stop();
      return;
    }
    if (user) {
      this.applyAudioVolume(user);
    }
  }

  /**
   * Applies playback state while retaining Agora's handling of browser autoplay restrictions.
   */
  private applyAudioVolume(
    user: IAgoraRTCRemoteUser
  ): void {
    const track = user.audioTrack;
    if (!track) {
      return;
    }
    const volume = this.audioVolumes.get(String(user.uid)) ?? 0;
    track.setVolume(volume);
    if (volume > 0 && this.requestedAudio.has(String(user.uid))) {
      track.play();
    }
    else {
      track.stop();
    }
  }

  /**
   * Returns original remote audio independently of Agora player playback.
   */
  getRemoteAudioTrack(
    userID: string
  ): MediaStreamTrack | undefined {
    const user = this.client?.remoteUsers.find(user => String(user.uid) === userID);
    return user?.hasAudio ? user.audioTrack?.getMediaStreamTrack() : undefined;
  }

  /**
   * Awaits control messages in order while replacing unsent snapshots and not serially awaiting snapshot
   * acknowledgments.
   */
  async sendRoomMessage(
    message: string,
    delivery: RtcRoomMessageDelivery = "ordered",
    signal?: AbortSignal,
  ): Promise<void> {
    const version = this.roomVersion;
    const client = this.client;
    const bytes = new TextEncoder().encode(message).byteLength;
    if (signal?.aborted || !client || !this.connection || (this.tokenExpired && !this.rejoinOperation)) {
      throw this.cancelled();
    }
    if (bytes > 1000) {
      throw new XmaxError(
        XmaxErrorCode.invalidConfiguration,
        "Room message exceeds the 1000-byte limit"
      );
    }

    const pending: PendingRoomMessage = {
      client,
      version,
      message,
      concurrent: delivery === "concurrent",
      signal,
    };
    if (delivery === "latest") {
      this.latestMessage = pending;
      this.scheduleRoomMessages();
      return;
    }

    // Task controls form a barrier; ordinary ordered messages such as heartbeats retain the latest interaction position.
    if (delivery === "barrier" || delivery === "concurrent") {
      this.latestMessage = undefined;
    }
    return new Promise<void>((
      resolve,
      reject
    ) => {
      const cancel = () => {
        const index = this.orderedMessages.indexOf(pending);
        if (index !== -1) {
          this.orderedMessages.splice(index, 1);
        }
        pending.completion?.reject(this.cancelled());
      };
      pending.completion = {
        resolve: () => {
          signal?.removeEventListener("abort", cancel);
          resolve();
        },
        reject: error => {
          signal?.removeEventListener("abort", cancel);
          reject(error);
        },
      };
      this.orderedMessages.push(pending);
      signal?.addEventListener("abort", cancel, { once: true });
      this.scheduleRoomMessages();
    });
  }

  /**
   * Runs one room-message scheduler, preserving control order and coalescing unsent snapshots.
   */
  private scheduleRoomMessages(): void {
    if (this.messageDrain || (!this.orderedMessages.length && !this.latestMessage)) {
      return;
    }
    const drain = {};
    this.messageDrain = drain;
    void this.drainRoomMessages(drain);
  }

  /**
   * Preserves submission order, awaiting ordinary controls while allowing bounded concurrent command
   * attempts and snapshots to proceed before preceding gateway responses.
   */
  private async drainRoomMessages(
    drain: object,
  ): Promise<void> {
    try {
      while (this.messageDrain === drain) {
        const pending = this.orderedMessages[0] ?? this.latestMessage;
        if (!pending || ((!pending.completion || pending.concurrent) && this.activeSends.size >= 30)) {
          return;
        }

        try {
          await this.rejoinOperation;
          if (this.messageDrain !== drain) {
            return;
          }
          // Recovery waits may admit newer snapshots or controls; do not send the obsolete selection.
          if (pending !== (this.orderedMessages[0] ?? this.latestMessage)) {
            continue;
          }
          if (pending.signal?.aborted) {
            throw this.cancelled();
          }
          this.ensureRoomCurrent(
            pending.client,
            pending.version
          );
          if (this.tokenExpired) {
            throw this.cancelled();
          }

          if (pending.completion) {
            this.orderedMessages.shift();
          } else {
            this.latestMessage = undefined;
          }
          const sending = this.sendWithTimeout(
            pending.client,
            pending.message,
            pending.signal,
          );
          if (pending.completion && pending.concurrent) {
            void sending.then(pending.completion.resolve, pending.completion.reject)
              .finally(() => this.scheduleRoomMessages());
          } else if (pending.completion) {
            await sending;
            pending.completion.resolve();
          } else {
            void sending.catch(error => this.reportLatestMessageFailure(
              pending,
              error
            )).finally(() => this.scheduleRoomMessages());
          }
        } catch (error) {
          if (this.orderedMessages[0] === pending) {
            this.orderedMessages.shift();
          }
          if (this.latestMessage === pending) {
            this.latestMessage = undefined;
          }
          if (pending.completion) {
            pending.completion.reject(this.mapError(error));
          } else {
            this.reportLatestMessageFailure(
              pending,
              error
            );
          }
        }
      }
    } finally {
      if (this.messageDrain === drain) {
        this.messageDrain = undefined;
      }
    }
  }

  /**
   * Reports snapshot failures without terminating generation or warning for cancelled obsolete-room
   * work.
   */
  private reportLatestMessageFailure(
    pending: PendingRoomMessage,
    error: unknown,
  ): void {
    if (this.isRoomCurrent(
      pending.client,
      pending.version
    ) && this.mapError(error).code !== XmaxErrorCode.cancelled) {
      XmaxLogger.rtc.warning(() => "发送实时房间快照失败，已丢弃当前采样帧 (Latest Room Message Dropped)");
    }
  }

  /**
   * Times out sends after five seconds; leaving cancels waits and late native results cannot affect a
   * new room.
   */
  private async sendWithTimeout(
    client: AgoraDataStreamClient,
    message: string,
    signal?: AbortSignal,
  ): Promise<void> {
    await new Promise<void>((
      resolve,
      reject
    ) => {
      let settled = false;
      const finish = (error?: unknown) => {
        if (settled) {
          return;
        }
        settled = true;
        clearTimeout(timer);
        signal?.removeEventListener("abort", cancel);
        this.activeSends.delete(cancel);
        if (error) {
          reject(this.mapError(error));
        }
        else {
          resolve();
        }
      };
      const cancel = () => finish(this.cancelled());
      const timer = setTimeout(
        () => finish(new XmaxError(
          XmaxErrorCode.timeout,
          "Agora room message send timed out"
        )),
        5000
      );
      this.activeSends.add(cancel);
      signal?.addEventListener("abort", cancel, { once: true });
      if (signal?.aborted) {
        cancel();
        return;
      }

      // Observe synchronous failures and rejected promises even when cancellation or timeout has already settled the wait.
      void this.run(() => client.sendStreamMessage(
        message,
        false
      )).then(
        () => finish(),
        finish
      );
    });
  }

  /**
   * Sets the shared RTC event listener.
   */
  setEventListener(
    listener?: RtcEventListener
  ): void {
    this.listener = listener;
  }

  /**
   * Bridges Agora publication, DataStream, quality, and token events to shared RTC events.
   */
  private registerEvents(
    client: AgoraDataStreamClient
  ): void {
    const active = () => this.client === client && this.connection !== undefined && !this.rejoinTask;
    const mediaActive = () => active() && !this.tokenExpired;
    const handleExpired = () => {
      if (!active() || this.tokenExpired) {
        return;
      }
      this.tokenExpired = true;
      this.listener?.onNetworkStatistics?.(undefined);
      this.listener?.onTokenExpired?.();
    };
    client.on(
      "user-published",
      (
        user,
        kind
      ) => {
        if (!mediaActive()) {
          return;
        }
        if (kind === "video") {
          this.listener?.onRemoteVideoPublished(
            String(user.uid),
            true
          );
        }
        if (kind === "audio" && this.requestedAudio.has(String(user.uid))) {
          void this.subscribeRemoteAudio(
            String(user.uid),
            true
          ).catch(error => {
            if (active()) {
              this.listener?.onError?.(this.mapError(error));
            }
          });
        }
      }
    );
    client.on(
      "user-unpublished",
      (
        user,
        kind
      ) => {
        if (!mediaActive()) {
          return;
        }
        if (kind === "video") {
          this.listener?.onRemoteVideoPublished(
            String(user.uid),
            false
          );
        }
        if (kind === "audio") {
          user.audioTrack?.stop();
          this.listener?.onRemoteAudioTrackChanged?.(String(user.uid));
        }
      }
    );
    client.on(
      "user-left",
      user => {
        if (mediaActive()) {
          this.listener?.onRemoteVideoPublished(
            String(user.uid),
            false
          );
        }
      }
    );
    client.on(
      "stream-message",
      (
        uid,
        data
      ) => {
        if (mediaActive()) {
          this.listener?.onCustomMessageReceived(
            String(uid),
            typeof data === "string" ? data : new TextDecoder().decode(data)
          );
        }
      }
    );
    client.on(
      "network-quality",
      quality => {
        if (mediaActive() && !this.networkQualitySuspended) {
          AgoraRtcStatistics.network(
            quality,
            this.listener
          );
        }
      }
    );
    client.on(
      "token-privilege-will-expire",
      () => {
        if (active() && !this.tokenExpired) {
          this.listener?.onTokenWillExpire?.();
        }
      }
    );
    client.on(
      "token-privilege-did-expire",
      handleExpired
    );
    client.on(
      "connection-state-change",
      (
        state,
        previous,
        reason
      ) => {
        if (this.client === client) {
          this.networkQualitySuspended = state !== "CONNECTED";
        }
        if (active() && state !== "CONNECTED") {
          this.listener?.onNetworkStatistics?.(undefined);
        }
        // Token-expiry disconnection may precede did-expire; merge both into one recovery request.
        if (state === "DISCONNECTED" && reason === "TOKEN_EXPIRE") {
          handleExpired();
          return;
        }
        if (active() && !this.tokenExpired && state === "DISCONNECTED" && previous !== "DISCONNECTED") {
          this.listener?.onError?.(new XmaxError(
            XmaxErrorCode.rtcError,
            `Agora connection disconnected: ${reason ?? "unknown"}`
          ));
        }
      }
    );
  }

  /**
   * Clears room state, playback, and queues while retaining prepared tracks.
   */
  private clearRoom(): void {
    this.roomVersion++;
    this.cancelRejoin?.();
    this.connection = undefined;
    this.tokenExpired = false;
    this.networkQualitySuspended = false;
    this.videoPublishRequested = false;
    this.audioPublishRequested = false;
    clearInterval(this.statisticsTimer);
    this.statisticsTimer = undefined;
    this.messageDrain = undefined;
    this.latestMessage = undefined;
    for (const pending of this.orderedMessages.splice(0)) {
      pending.completion?.reject(this.cancelled());
    }
    for (const cancel of this.activeSends) {
      cancel();
    }
    this.requestedAudio.clear();
    this.audioVolumes.clear();
    for (const user of this.client?.remoteUsers ?? []) {
      user.audioTrack?.stop();
    }
  }

  /**
   * Checks whether recovery still belongs to the current room lifecycle.
   */
  private isRoomCurrent(
    client: AgoraDataStreamClient,
    version: number
  ): boolean {
    return this.client === client && this.connection !== undefined && this.roomVersion === version;
  }

  /**
   * Rejects further recovery steps after leaving, destruction, or room replacement.
   */
  private ensureRoomCurrent(
    client: AgoraDataStreamClient,
    version: number
  ): void {
    if (!this.isRoomCurrent(
      client,
      version
    )) {
      throw this.cancelled();
    }
  }

  /**
   * Returns the initialized client.
   */
  private requireClient(): AgoraDataStreamClient {
    if (!this.client) {
      throw new XmaxError(
        XmaxErrorCode.rtcError,
        "Agora is not initialized"
      );
    }
    return this.client;
  }

  /**
   * Returns the prepared local video track.
   */
  private requireLocalVideo(): ILocalVideoTrack {
    const video = this.externalVideo;
    if (!video) {
      throw new XmaxError(
        XmaxErrorCode.invalidConfiguration,
        "Local video source is not prepared"
      );
    }
    return video;
  }

  /**
   * Runs an Agora operation and normalizes its failure.
   */
  private async run<T>(
    operation: () => Promise<T>
  ): Promise<T> {
    try {
      return await operation();
    }
    catch (error) {
      throw this.mapError(error);
    }
  }

  /**
   * Preserves provider error codes without exposing raw messages that may contain tokens.
   */
  private mapError(
    error: unknown
  ): XmaxError {
    if (error instanceof XmaxError) {
      return error;
    }
    const code = typeof error === "object" && error !== null && "code" in error ? String(error.code) : "UNKNOWN";
    const safeCode = /^[A-Z_0-9-]+$/.test(code) ? code : "UNKNOWN";
    return new XmaxError(
      XmaxErrorCode.rtcError,
      `Agora operation failed (${safeCode})`
    );
  }

  /**
   * Creates the cancellation error for obsolete Agora operations.
   */
  private cancelled(): XmaxError {
    return new XmaxError(
      XmaxErrorCode.cancelled,
      "Agora operation was cancelled"
    );
  }
}
