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
import type { NetworkQuality, TRTCStatistics } from "trtc-sdk-v5";
import { XmaxLogger } from "../../Logging/XmaxLogger";
import { CameraPosition } from "../../Media/Camera/CameraPosition";
import {
  RtcEngineManager,
  type RtcEngine,
  type RtcEngineLease,
} from "./RtcEngineManager";
import type { RtcEventListener } from "../RtcEventListener";
import { networkQualityLevel } from "../NetworkStatistics";
import type { RtcRoomJoinConfiguration } from "../RoomJoinConfiguration";
import type { RtcCameraCaptureOptions, RtcManaging } from "../RtcManaging";
import { RtcStatsLogger } from "../RtcStatsLogger";
import type { UplinkVideoStatistics, DownlinkVideoStatistics } from "../VideoStatistics";
import { rtcOrientedVideoSize } from "../RtcVideoOrientation";
import { canControlTrtcRemoteAudioVolume } from "./TrtcAudioVolumeSupport";
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
 * The placeholder capture bitrate, in kbps, replaced before publication by the encoding controller.
 */
const CAPTURE_PLACEHOLDER_BITRATE = 1000;

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

/**
 * The TRTC media and room adapter.
 *
 * TRTC owns capture and browser compatibility. Unpublished capture tracks are rendered through SDK
 * views, and room signaling uses custom messages with cmdId 1.
 */
export class TrtcRtcManager implements RtcManaging {

  /**
   * The manager supplying exclusive TRTC engine leases.
   */
  private readonly engineManager: RtcEngineManager;

  /**
   * The active engine lease.
   */
  private lease?: RtcEngineLease;

  /**
   * Whether camera capture is active.
   */
  private isCapturing = false;

  /**
   * Whether local audio capture is active.
   */
  private isAudioCapturing = false;

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

  /**
   * The shared RTC event listener.
   */
  private eventListener?: RtcEventListener;

  /**
   * The disposer for RTC statistics event listeners.
   */
  private removeStatsListeners?: () => void;

  /**
   * Creates a TRTC adapter.
   */
  constructor(
    engineManager: RtcEngineManager = RtcEngineManager.shared
  ) {
    this.engineManager = engineManager;
  }

  /**
   * Whether the RTC engine is initialized.
   */
  get isInitialized(): boolean {
    return this.lease !== undefined;
  }

  /**
   * Acquires an exclusive engine and registers event bridges, doing nothing when already initialized.
   */
  async initialize(): Promise<void> {
    if (this.lease) {
      return;
    }
    const lease = await this.engineManager.acquire();
    this.registerEventBridge(lease.engine);
    this.lease = lease;
  }

  /**
   * Releases capture, publication, the engine, and its lease; repeated calls without initialization do
   * nothing.
   */
  async destroy(): Promise<void> {
    const lease = this.lease;
    this.lease = undefined;
    const externalVideo = this.externalVideo;
    const externalAudio = this.externalAudio;
    this.externalVideo = undefined;
    this.externalAudio = undefined;
    this.isCapturing = false;
    this.isAudioCapturing = false;
    this.isInRoom = false;

    this.removeStatsListeners?.();
    this.removeStatsListeners = undefined;

    if (!lease) {
      externalVideo?.stop();
      externalAudio?.stop();
      return;
    }

    try {
      await lease.engine.stopLocalAudio();
    } catch {
      // Audio-stop failure must not prevent engine-lease release.
    }

    try {
      await lease.engine.stopLocalVideo();
    } catch {
      // Capture-stop failure must not prevent engine-lease release.
    }

    externalVideo?.stop();
    externalAudio?.stop();
    this.engineManager.release(lease);
  }

  /**
   * Prepares external audio/video clones without publication, retaining ownership of the original tracks
   * at the source.
   */
  async setExternalMediaTracks(
    tracks: {
      videoTrack: MediaStreamTrack;
      audioTrack?: MediaStreamTrack
    }
  ): Promise<void> {
    const engine = this.requireEngine();
    if (this.isCapturing || this.isAudioCapturing || this.externalVideo) {
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
      if (this.lease?.engine !== engine) {
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
        if (this.lease?.engine !== engine) {
          throw new XmaxError(
            XmaxErrorCode.cancelled,
            "External media preparation was cancelled"
          );
        }
      }
    } catch (error) {
      if (this.lease?.engine === engine) {
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

  /**
   * Updates disconnected camera dimensions and frame rate without replacing its device or capture
   * lifecycle.
   */
  async updateCameraCapture(
    options: RtcCameraCaptureOptions
  ): Promise<MediaStreamTrack> {
    const engine = this.requireEngine();
    if (!this.isCapturing || this.externalVideo || this.isInRoom) {
      throw new XmaxError(
        XmaxErrorCode.invalidConfiguration,
        "A disconnected camera preview is required"
      );
    }
    const size = rtcOrientedVideoSize(options);
    try {
      await engine.updateLocalVideo({
        option: {
          profile: {
            width: size.width,
            height: size.height,
            frameRate: options.frameRate,
            bitrate: CAPTURE_PLACEHOLDER_BITRATE,
          }
        }
      });
      if (this.lease?.engine !== engine || !this.isCapturing) {
        throw new XmaxError(
          XmaxErrorCode.cancelled,
          "Camera capture stopped during format update"
        );
      }
      const track = engine.getVideoTrack();
      if (!track) {
        throw new XmaxError(
          XmaxErrorCode.mediaError,
          "RTC engine did not produce a camera video track"
        );
      }
      return track;
    } catch (error) {
      throw this.mapError(error);
    }
  }

  /**
   * Starts camera capture without publication.
   *
   * @returns The captured video track.
   * @throws Rejects for uninitialized or active capture, unavailable devices, or denied permission.
   */
  async startCameraCapture(
    options: RtcCameraCaptureOptions,
  ): Promise<MediaStreamTrack> {
    if (options.rotation !== undefined && options.rotation !== 0) {
      throw new XmaxError(
        XmaxErrorCode.invalidConfiguration,
        "Camera rotation currently requires Agora"
      );
    }
    const engine = this.requireEngine();
    if (this.isCapturing || this.externalVideo) {
      throw new XmaxError(
        XmaxErrorCode.invalidConfiguration,
        "Camera capture is already running",
      );
    }
    try {
      // Compensate for mobile portrait transposition so the transmitted orientation matches the request.
      const captureSize = rtcOrientedVideoSize({
        width: options.width,
        height: options.height,
      });
      await engine.startLocalVideo({
        publish: false,
        option: {
          useFrontCamera: options.position === CameraPosition.front,
          profile: {
            width: captureSize.width,
            height: captureSize.height,
            frameRate: options.frameRate,
            bitrate: CAPTURE_PLACEHOLDER_BITRATE,
          },
        },
      });
      const track = engine.getVideoTrack();
      if (!track) {
        throw new XmaxError(
          XmaxErrorCode.mediaError,
          "RTC engine did not produce a camera video track",
        );
      }
      this.isCapturing = true;
      return track;
    } catch (error) {
      throw this.mapError(error);
    }
  }

  /**
   * Switches between front and rear cameras.
   *
   * @returns The current capture video track.
   * @throws Rejects without initialized capture or if switching fails.
   */
  async switchCameraCapture(
    to: CameraPosition
  ): Promise<MediaStreamTrack> {
    const engine = this.requireEngine();
    if (!this.isCapturing) {
      throw new XmaxError(
        XmaxErrorCode.invalidConfiguration,
        "Camera capture is not running",
      );
    }
    try {
      await engine.updateLocalVideo({
        option: { useFrontCamera: to === CameraPosition.front },
      });
      const track = engine.getVideoTrack();
      if (!track) {
        throw new XmaxError(
          XmaxErrorCode.mediaError,
          "RTC engine did not produce a camera video track after switching",
        );
      }
      return track;
    } catch (error) {
      throw this.mapError(error);
    }
  }

  /**
   * Stops camera capture, doing nothing when capture or the engine is inactive.
   */
  async stopCameraCapture(): Promise<void> {
    if (this.externalVideo) {
      return;
    }
    const engine = this.lease?.engine;
    this.isCapturing = false;
    if (!engine) {
      return;
    }
    try {
      await engine.stopLocalVideo();
    } catch (error) {
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
    if (this.isInRoom) {
      throw new XmaxError(
        XmaxErrorCode.invalidConfiguration,
        "Already in an RTC room",
      );
    }

    try {
      await engine.enterRoom({
        sdkAppId,
        userId: configuration.userID,
        userSig: configuration.userSig,
        strRoomId: configuration.roomID,
        privateMapKey: configuration.privateMapKey,
        // Require explicit audio subscription after applying volume to avoid initial playback at TRTC defaults.
        autoReceiveAudio: false,
      });
      this.isInRoom = true;
    } catch (error) {
      throw this.mapError(error);
    }
  }

  /**
   * Leaves the active room when initialized; failures are logged without rejecting cleanup.
   */
  async leaveRoom(): Promise<void> {
    const engine = this.lease?.engine;
    if (!engine || !this.isInRoom) {
      return;
    }

    this.isInRoom = false;
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
   * Configures video encoding using minimumBitrate as TRTC's single target bitrate and mapping the
   * encoding preference to its adaptation mode.
   *
   * @throws Rejects if local video is unavailable or configuration fails.
   */
  async configureVideoEncoding(
    configuration: VideoEncodingConfiguration,
  ): Promise<void> {
    const engine = this.requireEngine();
    if (!this.isCapturing && !this.externalVideo) {
      throw new XmaxError(
        XmaxErrorCode.invalidConfiguration,
        "Local video is not prepared",
      );
    }
    try {
      // External Canvas orientation is already resolved; only native camera input requires mobile transposition.
      const encodingSize = this.externalVideo ? configuration : rtcOrientedVideoSize({
        width: configuration.width,
        height: configuration.height,
      });
      await engine.updateLocalVideo({
        option: {
          profile: {
            width: encodingSize.width,
            height: encodingSize.height,
            frameRate: configuration.frameRate,
            bitrate: configuration.minimumBitrate,
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
    if (!this.isCapturing && !this.externalVideo) {
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
   * Unpublishes video while retaining capture and preview.
   */
  async unpublishLocalVideo(): Promise<void> {
    const engine = this.lease?.engine;
    if (!engine || (!this.isCapturing && !this.externalVideo)) {
      return;
    }
    try {
      await engine.updateLocalVideo({ publish: false });
    } catch (error) {
      throw this.mapError(error);
    }
  }

  /**
   * Publishes file audio or microphone input, never starting a microphone for an audio-free file source.
   *
   * @throws Rejects for an uninitialized engine, denied permission, or publication failure.
   */
  async publishLocalAudio(): Promise<void> {
    const engine = this.requireEngine();
    try {
      if (this.externalVideo) {
        if (this.externalAudio) {
          await engine.updateLocalAudio({ publish: true });
        }
      } else if (!this.isAudioCapturing) {
        await engine.startLocalAudio();
        this.isAudioCapturing = true;
      } else {
        await engine.updateLocalAudio({ publish: true });
      }
    } catch (error) {
      throw this.mapError(error);
    }
  }

  /**
   * Unpublishes local audio while retaining microphone capture.
   */
  async unpublishLocalAudio(): Promise<void> {
    const engine = this.lease?.engine;
    if (!engine || (!this.isAudioCapturing && !this.externalAudio)) {
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
    message: string
  ): Promise<void> {
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
    engine: RtcEngine
  ): void {
    const source = engine as unknown as RtcEventSource;

    // Use TRTC's statistics cadence without another timer, ignoring events from left rooms or obsolete engines.
    const onStatistics = (stats: TRTCStatistics) => {
      if (this.isInRoom && this.lease?.engine === engine) {
        RtcStatsLogger.logConnectionStatistics({
          rttMs: stats.rtt,
          uplinkLossPercent: stats.upLoss,
          downlinkLossPercent: stats.downLoss,
          sentBytes: stats.bytesSent,
          receivedBytes: stats.bytesReceived,
        });
        const video = stats.localStatistics?.video?.find((item) => item.videoType === "big");
        const valid = (
          value: number | undefined,
          minimum: number
        ) =>
          typeof value === "number" && Number.isFinite(value) && value >= minimum ? value : undefined;
        // TRTC uplink frameRate is an encoding rate, not a capture or send rate.
        const localVideo: UplinkVideoStatistics | undefined = video ? Object.freeze({
          width: valid(
            video.width,
            1
          ),
          height: valid(
            video.height,
            1
          ),
          encodeFrameRate: valid(
            video.frameRate,
            0
          ),
          bitrateKbps: valid(
            video.bitrate,
            0
          ),
          packetLossPercent: stats.upLoss <= 100 ? valid(
            stats.upLoss,
            0
          ) : undefined,
        }) : undefined;
        this.eventListener?.onLocalVideoStatistics?.(localVideo);
        if (localVideo) {
          RtcStatsLogger.logUplinkVideoStatistics(localVideo);
        }

        const remoteVideo: readonly DownlinkVideoStatistics[] = Object.freeze(
          (stats.remoteStatistics ?? []).flatMap((remote) => {
            const video = remote.video?.find((item) => item.videoType === "big");
            if (!video) {
              return [];
            }
            // Use the optional runtime E2E field absent from native typings; do not substitute buffering delay.
            const playback = video as typeof video & {
              point2pointDelay?: number;
            };
            return [Object.freeze({
              userID: remote.userId,
              width: valid(
                video.width,
                1
              ),
              height: valid(
                video.height,
                1
              ),
              decodeFrameRate: valid(
                video.frameRate,
                0
              ),
              bitrateKbps: valid(
                video.bitrate,
                0
              ),
              packetLossPercent: stats.downLoss <= 100 ? valid(
                stats.downLoss,
                0
              ) : undefined,
              endToEndDelayMs: valid(
                playback.point2pointDelay,
                0
              ),
            })];
          }),
        );
        this.eventListener?.onRemoteVideoStatistics?.(remoteVideo);
        for (const video of remoteVideo) {
          RtcStatsLogger.logDownlinkVideoStatistics(video);
        }
      }
    };

    const onNetworkQuality = (stats: NetworkQuality) => {
      if (this.isInRoom && this.lease?.engine === engine) {
        const quality = Object.freeze({
          uplink: networkQualityLevel(stats.uplinkNetworkQuality),
          downlink: networkQualityLevel(stats.downlinkNetworkQuality),
        });
        RtcStatsLogger.logNetworkQuality({
          ...quality,
          uplinkRTT: stats.uplinkRTT,
          downlinkRTT: stats.downlinkRTT,
          uplinkLoss: stats.uplinkLoss,
          downlinkLoss: stats.downlinkLoss,
        });
        this.eventListener?.onNetworkStatistics?.(quality);
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
      if (this.isInRoom && this.lease?.engine === engine) {
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
        if (this.lease?.engine !== engine || event.streamType !== STREAM_TYPE_MAIN) {
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
        if (this.lease?.engine !== engine || event.streamType !== STREAM_TYPE_MAIN) {
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
        if (this.lease?.engine !== engine || event.cmdId !== CUSTOM_MESSAGE_CMD_ID) {
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
  private requireEngine(): RtcEngine {
    const engine = this.lease?.engine;
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
