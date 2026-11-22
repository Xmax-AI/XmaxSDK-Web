//
//  TrtcRtcManager.ts
//  XmaxSDK
//
//  Author: 翁跃庭 (Yueting Weng)
//  GitHub: https://github.com/Xmax-AI/XmaxSDK-Web
//
//  Copyright (c) 2026 XMAX.AI PTE. LTD.
//

import { RtcProvider } from "../RtcProvider";
import { XmaxError, XmaxErrorCode } from "../../Errors/XmaxError";
import type { default as TRTC, NetworkQuality, TRTCStatistics } from "trtc-sdk-v5";
import { XmaxLogger } from "../../Logging/XmaxLogger";
import type { RtcEventListener } from "../RtcEventListener";
import type { RtcRoomJoinConfiguration } from "../RoomJoinConfiguration";
import type { RtcLocalMediaTracks, RtcManaging, RtcRoomMessageDelivery } from "../RtcManaging";
import { canControlTrtcRemoteAudioVolume } from "./TrtcAudioVolumeSupport";
import { TrtcRtcStatistics } from "./TrtcRtcStatistics";
import {
  RtcVideoEncoderPreference,
  type VideoEncodingConfiguration,
} from "../VideoEncodingConfiguration";

/**
 * TRTC event-name literals that do not require loading browser runtime constants.
 */
const RTC_EVENT = {
  remoteVideoAvailable: "remote-video-available",
  remoteVideoUnavailable: "remote-video-unavailable",
  remoteAudioAvailable: "remote-audio-available",
  remoteAudioUnavailable: "remote-audio-unavailable",
  customMessage: "custom-message",
  statistics: "statistics",
  networkQuality: "network-quality",
} as const;

/**
 * The TRTC main-video stream identifier.
 */
const STREAM_TYPE_MAIN = "main";

/**
 * The command ID used for room messages.
 */
const CUSTOM_MESSAGE_CMD_ID = 1;

/**
 * The encoded room-message byte limit.
 */
const ROOM_MESSAGE_MAX_BYTES = 1000;

/**
 * The mapping from encoding preferences to TRTC network-adaptation modes.
 */
const QOS_PREFERENCE_MAP: Record<RtcVideoEncoderPreference, "smooth" | "clear"> = {
  [RtcVideoEncoderPreference.maintainFramerate]: "smooth",
  [RtcVideoEncoderPreference.maintainQuality]: "clear",
};

/**
 * The minimum engine event interface, independent of the TRTC event enum.
 */
interface RtcEventSource {

  /**
   * Registers a handler for an RTC event.
   */
  on(
    event: string,
    handler: (
      event: never
    ) => void
  ): void;

  /**
   * Removes a handler for an RTC event.
   */
  off(
    event: string,
    handler: (
      event: never
    ) => void
  ): void;
}

/**
 * The TRTC remote-video event payload.
 */
interface RtcRemoteVideoEvent {

  /**
   * The RTC user associated with the event.
   */
  userId: string;

  /**
   * The TRTC main or auxiliary video-stream type.
   */
  streamType: string;
}

/**
 * The TRTC custom-message event payload.
 */
interface RtcCustomMessageEvent {

  /**
   * The RTC user associated with the event.
   */
  userId: string;

  /**
   * The custom-message command ID.
   */
  cmdId: number;

  /**
   * The raw custom-message bytes.
   */
  data: ArrayBuffer;
}

type TrtcSdk = Pick<typeof TRTC, "create" | "setLogLevel">;

/** Owns a TRTC client and adapts media publication, subscription, and room events. */
export class TrtcRtcManager implements RtcManaging {

  /** Lazily loads the TRTC runtime. */
  private readonly loadSDK: () => Promise<TrtcSdk>;

  /** The client owned by this adapter. */
  private engine?: TRTC;

  /** Shares initialization within this adapter and invalidates it on destroy. */
  private initialization?: Promise<void>;

  /** Invalidates obsolete initialization after destruction. */
  private lifecycle = 0;

  /**
   * The adapter-owned external-video clone.
   */
  private externalVideo?: MediaStreamTrack;

  /**
   * The adapter-owned external-audio clone.
   */
  private externalAudio?: MediaStreamTrack;

  /**
   * Whether the engine has joined a room.
   */
  private isInRoom = false;

  /** Lets teardown finish an in-flight room transition before destroying its client. */
  private roomOperation?: { kind: "join" | "leave"; promise: Promise<void> };

  /**
   * The shared RTC event listener.
   */
  private eventListener?: RtcEventListener;

  /**
   * The disposer for RTC statistics event listeners.
   */
  private removeStatsListeners?: () => void;

  /**
   * Creates an adapter without loading browser dependencies or requesting device permission.
   */
  constructor(
    options: { loadSDK?: () => Promise<TrtcSdk> } = {}
  ) {
    this.loadSDK = options.loadSDK ?? (async () => (await import("trtc-sdk-v5")).default);
  }

  /**
   * Whether the RTC engine is initialized.
   */
  get isInitialized(): boolean {
    return this.engine !== undefined;
  }

  /**
   * Initializes one client per adapter and shares simultaneous calls on that adapter.
   */
  async initialize(): Promise<void> {
    if (this.engine) {
      return;
    }
    if (this.initialization) {
      return this.initialization;
    }

    const operation = this.performInitialize(this.lifecycle);
    this.initialization = operation;
    try {
      await operation;
    } finally {
      if (this.initialization === operation) {
        this.initialization = undefined;
      }
    }
  }

  private async performInitialize(version: number): Promise<void> {
    const sdk = await this.loadSDK();
    if (version !== this.lifecycle) {
      throw new XmaxError(XmaxErrorCode.cancelled, "TRTC initialization was cancelled");
    }

    // Silence vendor console logs while retaining TRTC's default diagnostic uploads.
    sdk.setLogLevel(5);
    const engine = sdk.create();
    if (!engine) {
      throw new XmaxError(XmaxErrorCode.rtcError, "Failed to create RTC Engine");
    }
    this.engine = engine;
    try {
      this.registerEventBridge(engine);
    } catch (error) {
      await this.destroy();
      throw error;
    }
  }

  /**
   * Invalidates pending initialization, leaves the room, and releases this adapter's resources.
   */
  async destroy(): Promise<void> {
    this.lifecycle++;
    this.initialization = undefined;
    const engine = this.engine;
    const wasInRoom = this.isInRoom;
    const roomOperation = this.roomOperation;
    const externalVideo = this.externalVideo;
    const externalAudio = this.externalAudio;
    this.engine = undefined;
    this.roomOperation = undefined;
    this.externalVideo = undefined;
    this.externalAudio = undefined;
    this.isInRoom = false;

    this.removeStatsListeners?.();
    this.removeStatsListeners = undefined;

    if (!engine) {
      externalVideo?.stop();
      externalAudio?.stop();
      return;
    }

    const roomOperationCompleted = await roomOperation?.promise.then(() => true, () => false);
    if (wasInRoom || (roomOperation?.kind === "join" && roomOperationCompleted)) {
      await this.exitEngineRoom(engine);
    }

    try {
      await engine.stopLocalAudio();
    } catch {
      // Continue releasing the owned engine and tracks.
    }
    try {
      await engine.stopLocalVideo();
    } catch {
      // Continue releasing the owned engine and tracks.
    }
    externalVideo?.stop();
    externalAudio?.stop();

    try {
      engine.destroy();
    } catch (error) {
      XmaxLogger.rtc.warning(() => `TRTC 引擎销毁失败 (TRTC Destroy Failed)\n└─ ${XmaxError.from(error).message}`);
    }
  }

  /**
   * Prepares external audio/video clones without publication, retaining ownership of the original tracks
   * at the source.
   */
  async setExternalMediaTracks(
    tracks: RtcLocalMediaTracks
  ): Promise<void> {
    const engine = this.requireEngine();
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
        "External media tracks must be live video/audio tracks"
      );
    }

    const video = tracks.videoTrack.clone();
    this.externalVideo = video;
    let audio: MediaStreamTrack | undefined;
    try {
      audio = tracks.audioTrack?.clone();
      this.externalAudio = audio;
      await engine.startLocalVideo({
        publish: false,
        option: { videoTrack: video }
      });
      if (this.engine !== engine) {
        throw new XmaxError(
          XmaxErrorCode.cancelled,
          "External media preparation was cancelled"
        );
      }
      if (audio) {
        await engine.startLocalAudio({
          publish: false,
          option: {
            audioTrack: audio,
            echoCancellation: false,
            autoGainControl: false,
            noiseSuppression: false
          },
        });
        if (this.engine !== engine) {
          throw new XmaxError(
            XmaxErrorCode.cancelled,
            "External media preparation was cancelled"
          );
        }
      }
    } catch (error) {
      if (this.engine === engine) {
        await engine.stopLocalAudio().catch(() => { });
        await engine.stopLocalVideo().catch(() => { });
      }
      if (this.externalVideo === video) {
        this.externalVideo = undefined;
        this.externalAudio = undefined;
      }
      video.stop();
      audio?.stop();
      throw this.mapError(error);
    }
  }

  /** Changes the video track on an existing custom-video publication. */
  async replaceCameraVideoTrack(track: MediaStreamTrack): Promise<void> {
    const engine = this.requireEngine();
    const previous = this.externalVideo;
    if (!previous) {
      throw new XmaxError(XmaxErrorCode.invalidConfiguration, "SDK camera is not prepared for publication");
    }
    const replacement = track.clone();
    try {
      await engine.updateLocalVideo({ option: { videoTrack: replacement } });
      if (this.engine !== engine || this.externalVideo !== previous) {
        throw new XmaxError(XmaxErrorCode.cancelled, "Camera publication changed during replacement");
      }
      this.externalVideo = replacement;
      previous.stop();
    } catch (error) {
      replacement.stop();
      throw this.mapError(error);
    }
  }

  /**
   * Joins an RTC room.
   *
   * @throws Rejects for an uninitialized engine, invalid parameters, or join failure.
   */
  async joinRoom(
    configuration: RtcRoomJoinConfiguration
  ): Promise<void> {
    if (configuration.provider !== RtcProvider.trtc) {
      throw new XmaxError(
        XmaxErrorCode.invalidConfiguration,
        "TRTC credentials required"
      );
    }
    const engine = this.requireEngine();
    const sdkAppId = Number(configuration.sdkAppID);
    if (!Number.isInteger(sdkAppId) || sdkAppId <= 0) {
      throw new XmaxError(
        XmaxErrorCode.invalidConfiguration,
        "RTC sdkAppID is invalid",
      );
    }
    if (this.isInRoom || this.roomOperation) {
      throw new XmaxError(
        XmaxErrorCode.invalidConfiguration,
        "Already in an RTC room",
      );
    }

    let join: Promise<void> | undefined;
    try {
      join = engine.enterRoom({
        sdkAppId,
        userId: configuration.userID,
        userSig: configuration.userSig,
        strRoomId: configuration.roomID,
        privateMapKey: configuration.privateMapKey,
        // Require explicit audio subscription after applying volume to avoid initial playback at TRTC defaults.
        autoReceiveAudio: false,
      });
      this.roomOperation = { kind: "join", promise: join };
      await join;
      if (this.roomOperation?.promise === join) {
        this.isInRoom = true;
        return;
      }
    } catch (error) {
      if (!join || this.roomOperation?.promise === join) {
        throw this.mapError(error);
      }
    } finally {
      if (this.roomOperation?.promise === join) {
        this.roomOperation = undefined;
      }
    }
    throw new XmaxError(XmaxErrorCode.cancelled, "TRTC room join was cancelled");
  }

  /**
   * Cancels pending room entry and leaves any room opened by that entry.
   */
  async leaveRoom(): Promise<void> {
    const engine = this.engine;
    if (!engine) {
      return;
    }
    const pending = this.roomOperation;
    if (pending?.kind === "leave") {
      return pending.promise;
    }
    if (!this.isInRoom && !pending) {
      return;
    }

    this.isInRoom = false;
    const promise = pending
      ? pending.promise.then(() => this.exitEngineRoom(engine), () => { })
      : this.exitEngineRoom(engine);
    const operation = { kind: "leave", promise } as const;
    this.roomOperation = operation;
    try {
      await operation.promise;
    } finally {
      if (this.roomOperation === operation) {
        this.roomOperation = undefined;
      }
    }
  }

  private async exitEngineRoom(engine: TRTC): Promise<void> {
    try {
      await engine.exitRoom();
    } catch (error) {
      XmaxLogger.rtc.warning(
        () =>
          `退出 RTC 房间失败 (Failed to Leave RTC Room)\n` +
          `└─ ${XmaxLogger.localized("原因：", "Reason: ")}${XmaxError.from(error).message}`,
      );
    }
  }

  /**
   * Configures video encoding using maximumBitrate as TRTC's target bitrate and mapping the
   * encoding preference to its adaptation mode.
   *
   * @throws Rejects if local video is unavailable or configuration fails.
   */
  async configureVideoEncoding(
    configuration: VideoEncodingConfiguration,
  ): Promise<void> {
    const engine = this.requireEngine();
    if (!this.externalVideo) {
      throw new XmaxError(
        XmaxErrorCode.invalidConfiguration,
        "Local video is not prepared",
      );
    }
    try {
      await engine.updateLocalVideo({
        option: {
          profile: {
            width: configuration.width,
            height: configuration.height,
            frameRate: configuration.frameRate,
            bitrate: configuration.maximumBitrate,
          },
          qosPreference: QOS_PREFERENCE_MAP[configuration.encoderPreference],
        },
      });
    } catch (error) {
      throw this.mapError(error);
    }
  }

  /**
   * Publishes local video.
   *
   * @throws Rejects without prepared media or if publication fails.
   */
  async publishLocalVideo(): Promise<void> {
    const engine = this.requireEngine();
    if (!this.externalVideo) {
      throw new XmaxError(
        XmaxErrorCode.invalidConfiguration,
        "Local video is not prepared",
      );
    }
    try {
      await engine.updateLocalVideo({ publish: true });
    } catch (error) {
      throw this.mapError(error);
    }
  }

  /**
   * Unpublishes video while retaining the prepared track.
   */
  async unpublishLocalVideo(): Promise<void> {
    const engine = this.engine;
    if (!engine || !this.externalVideo) {
      return;
    }
    try {
      await engine.updateLocalVideo({ publish: false });
    } catch (error) {
      throw this.mapError(error);
    }
  }

  /**
   * Publishes the supplied audio track when available.
   *
   * @throws Rejects for an uninitialized engine or a publication failure.
   */
  async publishLocalAudio(): Promise<void> {
    const engine = this.requireEngine();
    if (!this.externalAudio) {
      return;
    }
    try {
      await engine.updateLocalAudio({ publish: true });
    } catch (error) {
      throw this.mapError(error);
    }
  }

  /**
   * Unpublishes local audio while retaining the prepared track.
   */
  async unpublishLocalAudio(): Promise<void> {
    const engine = this.engine;
    if (!engine || !this.externalAudio) {
      return;
    }
    try {
      await engine.updateLocalAudio({ publish: false });
    } catch (error) {
      throw this.mapError(error);
    }
  }

  /**
   * Changes a remote main-video subscription and returns the subscribed track for rendering.
   *
   * @throws Rejects without an engine or if the subscription change fails.
   */
  async subscribeRemoteVideo(
    userID: string,
    subscribe: boolean,
  ): Promise<MediaStreamTrack | undefined> {
    const engine = this.requireEngine();
    try {
      if (subscribe) {
        await engine.startRemoteVideo({
          userId: userID,
          streamType: STREAM_TYPE_MAIN as never,
        });
        const track = engine.getVideoTrack({ userId: userID });
        if (!track) {
          throw new XmaxError(
            XmaxErrorCode.mediaError,
            "Remote video track is not available",
          );
        }
        return track;
      }
      await engine.stopRemoteVideo({
        userId: userID,
        streamType: STREAM_TYPE_MAIN as never,
      });
      return undefined;
    } catch (error) {
      throw this.mapError(error);
    }
  }

  /**
   * Changes remote audio subscription.
   *
   * @throws Rejects without an engine or if the operation fails.
   */
  async subscribeRemoteAudio(
    userID: string,
    subscribe: boolean
  ): Promise<void> {
    const engine = this.requireEngine();
    try {
      await engine.muteRemoteAudio(
        userID,
        !subscribe
      );
    } catch (error) {
      throw this.mapError(error);
    }
  }

  /**
   * Whether this platform supports TRTC remote-volume control; false on iOS Safari and WKWebView.
   */
  get supportsRemoteAudioVolumeControl(): boolean {
    return canControlTrtcRemoteAudioVolume();
  }

  /**
   * Returns original remote audio, rejecting observation where independent playback-volume control is
   * unsupported.
   */
  getRemoteAudioTrack(
    userID: string
  ): MediaStreamTrack | undefined {
    if (!canControlTrtcRemoteAudioVolume()) {
      throw new XmaxError(
        XmaxErrorCode.mediaError,
        "TRTC cannot provide remote audio frames independently of playback on this platform"
      );
    }
    return this.requireEngine().getAudioTrack(userID) ?? undefined;
  }

  /**
   * Sets a remote user's playback volume.
   *
   * On iOS Safari and WKWebView, zero stops subscription playback and nonzero restores it. Restoring
   * playback may briefly buffer because the stream must be fetched again.
   *
   * @param volume - The requested volume, clamped to 0–100.
   */
  setRemoteAudioVolume(
    volume: number,
    userID: string
  ): void {
    const engine = this.requireEngine();
    const normalized = Math.min(Math.max(Math.round(volume), 0), 100);
    if (!canControlTrtcRemoteAudioVolume()) {
      void engine.muteRemoteAudio(
        userID,
        normalized === 0
      ).catch((error: unknown) => {
        XmaxLogger.rtc.warning(
          () =>
            `远端音频播放状态切换失败 (Failed to Toggle Remote Audio Playback)\n` +
            `└─ ${XmaxLogger.localized("原因：", "Reason: ")}${XmaxError.from(error).message}`,
        );
      });
      return;
    }
    engine.setRemoteAudioVolume(
      userID,
      normalized
    );
  }

  /**
   * Sends a room custom message with cmdId 1.
   *
   * @throws Rejects outside a room or when encoded text exceeds 1000 bytes.
   */
  async sendRoomMessage(
    message: string,
    _delivery?: RtcRoomMessageDelivery,
    signal?: AbortSignal,
  ): Promise<void> {
    if (signal?.aborted) {
      throw new XmaxError(XmaxErrorCode.cancelled, "RTC room message was cancelled");
    }
    const engine = this.requireEngine();
    if (!this.isInRoom) {
      throw new XmaxError(
        XmaxErrorCode.invalidConfiguration,
        "Not in an RTC room",
      );
    }

    const encoded = new TextEncoder().encode(message);
    if (encoded.byteLength > ROOM_MESSAGE_MAX_BYTES) {
      throw new XmaxError(
        XmaxErrorCode.invalidConfiguration,
        "Room message exceeds the 1000-byte limit",
      );
    }

    engine.sendCustomMessage({
      cmdId: CUSTOM_MESSAGE_CMD_ID,
      data: encoded.buffer as ArrayBuffer,
    });
  }

  /**
   * Retains TRTC join authentication while the session layer caches refreshed credentials.
   */
  async updateCredentials(
    _configuration: RtcRoomJoinConfiguration
  ): Promise<void> { }

  /**
   * Sets the RTC event listener; undefined removes it.
   */
  setEventListener(
    listener?: RtcEventListener
  ): void {
    this.eventListener = listener;
  }

  /**
   * Bridges native media, message, and performance events.
   */
  private registerEventBridge(
    engine: TRTC
  ): void {
    const source = engine as unknown as RtcEventSource;
    const receivesRoomEvents = () => this.engine === engine && this.roomOperation?.kind !== "leave";

    // Use TRTC's statistics cadence without another timer, ignoring events from left rooms or obsolete engines.
    const onStatistics = (stats: TRTCStatistics) => {
      if (this.isInRoom && this.engine === engine) {
        TrtcRtcStatistics.collect(stats, this.eventListener);
      }
    };

    const onNetworkQuality = (stats: NetworkQuality) => {
      if (this.isInRoom && this.engine === engine) {
        TrtcRtcStatistics.network(stats, this.eventListener);
      }
    };

    source.on(
      RTC_EVENT.statistics,
      onStatistics
    );
    source.on(
      RTC_EVENT.networkQuality,
      onNetworkQuality
    );
    const onAudioChanged = (event: RtcRemoteVideoEvent) => {
      if (this.isInRoom && this.engine === engine) {
        this.eventListener?.onRemoteAudioTrackChanged?.(event.userId);
      }
    };
    source.on(
      RTC_EVENT.remoteAudioAvailable,
      onAudioChanged
    );
    source.on(
      RTC_EVENT.remoteAudioUnavailable,
      onAudioChanged
    );
    this.removeStatsListeners = () => {
      source.off(
        RTC_EVENT.statistics,
        onStatistics
      );
      source.off(
        RTC_EVENT.networkQuality,
        onNetworkQuality
      );
      source.off(
        RTC_EVENT.remoteAudioAvailable,
        onAudioChanged
      );
      source.off(
        RTC_EVENT.remoteAudioUnavailable,
        onAudioChanged
      );
    };

    source.on(
      RTC_EVENT.remoteVideoAvailable,
      (event: RtcRemoteVideoEvent) => {
        if (!receivesRoomEvents() || event.streamType !== STREAM_TYPE_MAIN) {
          return;
        }
        this.eventListener?.onRemoteVideoPublished(
          event.userId,
          true
        );
      }
    );

    source.on(
      RTC_EVENT.remoteVideoUnavailable,
      (event: RtcRemoteVideoEvent) => {
        if (!receivesRoomEvents() || event.streamType !== STREAM_TYPE_MAIN) {
          return;
        }
        this.eventListener?.onRemoteVideoPublished(
          event.userId,
          false
        );
      }
    );

    source.on(
      RTC_EVENT.customMessage,
      (event: RtcCustomMessageEvent) => {
        if (!receivesRoomEvents() || event.cmdId !== CUSTOM_MESSAGE_CMD_ID) {
          return;
        }
        let message: string;
        try {
          message = new TextDecoder().decode(event.data);
        } catch {
          XmaxLogger.rtc.warning(() => "自定义消息解码失败 (Failed to Decode Custom Message)");
          return;
        }
        this.eventListener?.onCustomMessageReceived(
          event.userId,
          message
        );
      }
    );
  }

  /**
   * Returns the current engine or throws if uninitialized.
   */
  private requireEngine(): TRTC {
    const engine = this.engine;
    if (!engine) {
      throw new XmaxError(
        XmaxErrorCode.rtcError,
        "RTC engine is not initialized",
      );
    }
    return engine;
  }

  /**
   * Maps TRTC failures to SDK errors.
   */
  private mapError(
    error: unknown
  ): XmaxError {
    if (error instanceof XmaxError) {
      return error;
    }

    const rtcError = error as {
      message?: unknown;
      originError?: {
        name?: string
      };
    };
    const originName = rtcError?.originError?.name ?? "";
    const message =
      typeof rtcError?.message === "string" && rtcError.message.trim().length > 0
        ? rtcError.message.trim()
        : String(error);

    // TRTC may wrap getUserMedia permission-denial errors.
    if (
      originName === "NotAllowedError" ||
      originName === "SecurityError" ||
      /NotAllowed/i.test(message)
    ) {
      return new XmaxError(
        XmaxErrorCode.cameraPermissionDenied,
        message
      );
    }
    // Other original device errors represent missing, busy, or unsupported capture devices.
    if (originName) {
      return new XmaxError(
        XmaxErrorCode.mediaError,
        message
      );
    }

    return new XmaxError(
      XmaxErrorCode.rtcError,
      message
    );
  }
}
