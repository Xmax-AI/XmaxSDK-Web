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
  ICameraVideoTrack,
  IMicrophoneAudioTrack,
  ILocalVideoTrack,
  ILocalAudioTrack
} from "agora-rtc-sdk-ng";
import { XmaxError, XmaxErrorCode } from "../../Errors/XmaxError";
import { XmaxLogger } from "../../Logging/XmaxLogger";
import { CameraPosition } from "../../Media/Camera/CameraPosition";
import { XmaxEnvironment } from "../../../Core/XmaxEnvironment";
import type { RtcManaging, RtcCameraCaptureOptions, RtcRoomMessageDelivery } from "../RtcManaging";
import type { RtcEventListener } from "../RtcEventListener";
import type { RtcRoomJoinConfiguration, AgoraRoomJoinConfiguration } from "../RoomJoinConfiguration";
import { RtcVideoEncoderPreference, type VideoEncodingConfiguration } from "../VideoEncodingConfiguration";
import { AgoraRtcStatistics } from "./AgoraRtcStatistics";
import { rtcOrientedVideoSize } from "../RtcVideoOrientation";
import { AgoraVideoSender } from "./AgoraVideoSender";
import { validateCameraRotation } from "../../Media/Camera/CameraRotation";
import { CameraRotationProcessor } from "../../Media/Camera/CameraRotationProcessor";

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
   * The camera's local video output track.
   */
  private camera?: ILocalVideoTrack;

  /**
   * The original camera capture track before rotation.
   */
  private cameraSource?: ICameraVideoTrack;

  /**
   * The camera rotation processor.
   */
  private cameraRotation?: CameraRotationProcessor;

  /**
   * The capture revision rejecting results after a switch or stop.
   */
  private captureVersion = 0;

  /**
   * The active microphone capture track.
   */
  private microphone?: IMicrophoneAudioTrack;

  /**
   * The external-video clone owned by this adapter.
   */
  private externalVideo?: ILocalVideoTrack;

  /**
   * The external-audio clone owned by this adapter.
   */
  private externalAudio?: ILocalAudioTrack;

  /**
   * The last encoding preference applied to each local video track.
   */
  private readonly appliedOptimizationModes = new WeakMap<ILocalVideoTrack, RtcVideoEncoderPreference>();

  /**
   * The camera sender's current target encoding settings.
   */
  private cameraSenderConfiguration?: VideoEncodingConfiguration;

  /**
   * The serialized sender-parameter update chain.
   */
  private senderUpdateTail: Promise<void> = Promise.resolve();

  /**
   * The listener restoring parameters after sender replacement.
   */
  private cameraTransceiverListener?: () => void;

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
   * Invalidates asynchronous work before releasing room, capture, event, and region resources.
   */
  async destroy(): Promise<void> {
    this.lifecycle++;
    const client = this.client;
    // Retain the app listener for reuse after close; remove callbacks from the obsolete client separately.
    this.clearRoom();
    this.client = undefined;
    client?.removeAllListeners();
    this.releaseCameraCapture();
    this.microphone?.close();
    this.externalVideo?.close();
    this.externalAudio?.close();
    this.externalVideo = undefined;
    this.externalAudio = undefined;
    this.camera = undefined;
    this.microphone = undefined;

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
   * Captures camera video without publishing and returns its native track for shared rendering.
   */
  async startCameraCapture(
    options: RtcCameraCaptureOptions
  ): Promise<MediaStreamTrack> {
    const client = this.requireClient();
    if (this.camera || this.cameraSource || this.externalVideo) {
      throw new XmaxError(
        XmaxErrorCode.invalidConfiguration,
        "A local video source is already active"
      );
    }

    const rotation = options.rotation ?? 0;
    validateCameraRotation(rotation);
    const version = ++this.captureVersion;
    let source: ICameraVideoTrack | undefined;
    try {
      const captureSize = rtcOrientedVideoSize(rotation === 90 || rotation === 270
        ? {
          width: options.height,
          height: options.width
        } : options);
      source = await this.sdk!.createCameraVideoTrack({
        facingMode: options.position === CameraPosition.front ? "user" : "environment",
        encoderConfig: {
          width: captureSize.width,
          height: captureSize.height,
          frameRate: options.frameRate
        },
      });
      if (this.client !== client || version !== this.captureVersion) {
        source.close();
        throw this.cancelled();
      }
      this.cameraSource = source;
      let camera: ILocalVideoTrack = source;
      if (rotation !== 0) {
        const processor = new CameraRotationProcessor({
          ...options,
          rotation,
          onError: error => this.listener?.onError?.(error),
        });
        this.cameraRotation = processor;
        const output = await processor.setSource(source.getMediaStreamTrack());
        if (this.client !== client || version !== this.captureVersion) {
          throw this.cancelled();
        }
        camera = this.sdk!.createCustomVideoTrack({
          mediaStreamTrack: output,
          width: options.width,
          height: options.height,
          frameRate: options.frameRate,
        });
      }
      this.camera = camera;
      this.cameraTransceiverListener = () => {
        // Initial publication and explicit rejoin restore senders elsewhere; handle only automatic sender replacement here.
        if (this.client === client && client.localTracks.includes(camera) && this.videoPublishRequested && !this.rejoinTask) {
          void this.restoreCameraSender(camera).catch(() => {
            if (this.camera === camera && this.videoPublishRequested) {
              XmaxLogger.rtc.warning(() => "Agora 发送参数恢复失败 (Agora Sender Parameters Restore Failed)");
            }
          });
        }
      };
      camera.on(
        "transceiver-updated",
        this.cameraTransceiverListener
      );
      return camera.getMediaStreamTrack();
    } catch (error) {
      if (version === this.captureVersion) {
        this.releaseCameraCapture();
      }
      throw this.mapError(
        error,
        XmaxErrorCode.cameraPermissionDenied
      );
    }
  }

  /**
   * Updates unpublished camera capture while retaining the local track and rotation output.
   */
  async updateCameraCapture(
    options: RtcCameraCaptureOptions
  ): Promise<MediaStreamTrack> {
    const source = this.requireCamera();
    const camera = this.camera!;
    const client = this.requireClient();
    const version = this.captureVersion;
    if (this.connection || this.videoPublishRequested) {
      throw new XmaxError(
        XmaxErrorCode.invalidConfiguration,
        "Disconnect Agora before updating camera capture"
      );
    }
    const rotation = options.rotation ?? 0;
    validateCameraRotation(rotation);
    if ((rotation !== 0) !== !!this.cameraRotation) {
      throw new XmaxError(
        XmaxErrorCode.invalidConfiguration,
        "Camera format updates must preserve rotation"
      );
    }
    const ensureCurrent = () => {
      if (this.camera !== camera || this.cameraSource !== source || this.client !== client || version !== this.captureVersion) {
        throw this.cancelled();
      }
    };
    const size = rtcOrientedVideoSize(rotation === 90 || rotation === 270
      ? {
        width: options.height,
        height: options.width
      } : options);
    await this.run(() => source.setEncoderConfiguration({
      width: size.width,
      height: size.height,
      frameRate: options.frameRate
    }));
    ensureCurrent();
    if (this.cameraRotation) {
      await this.cameraRotation.updateFormat(
        options.width,
        options.height,
        options.frameRate
      );
      ensureCurrent();
    }
    return camera.getMediaStreamTrack();
  }

  /**
   * Switches the Agora camera device and returns its current native track.
   */
  async switchCameraCapture(
    to: CameraPosition
  ): Promise<MediaStreamTrack> {
    const source = this.requireCamera();
    const camera = this.camera!;
    // setDevice may end the old source; retain the last frame and output track during switching.
    this.cameraRotation?.pauseSource();
    try {
      await this.run(() => source.setDevice({ facingMode: to === CameraPosition.front ? "user" : "environment" }));
    } catch (error) {
      if (this.camera === camera && this.cameraRotation) {
        await this.cameraRotation.setSource(source.getMediaStreamTrack()).catch(restoreError => {
          this.listener?.onError?.(XmaxError.from(restoreError));
        });
      }
      throw error;
    }
    if (this.camera !== camera || this.cameraSource !== source) {
      throw this.cancelled();
    }
    if (this.cameraRotation) {
      await this.cameraRotation.setSource(source.getMediaStreamTrack());
      if (this.camera !== camera) {
        throw this.cancelled();
      }
    }
    if (this.videoPublishRequested) {
      await this.restoreCameraSender(camera);
    }
    return camera.getMediaStreamTrack();
  }

  /**
   * Stops capture and releases the camera.
   */
  async stopCameraCapture(): Promise<void> {
    this.releaseCameraCapture();
  }

  /**
   * Releases camera capture, rotation output, and sender state.
   */
  private releaseCameraCapture(): void {
    ++this.captureVersion;
    const camera = this.camera;
    this.releaseCameraSender();
    this.camera = undefined;
    camera?.close();
    this.cameraRotation?.stop();
    this.cameraRotation = undefined;
    if (this.cameraSource !== camera) {
      this.cameraSource?.close();
    }
    this.cameraSource = undefined;
  }

  /**
   * Wraps cloned external tracks as Agora local tracks without device access, releasing clones on
   * failure.
   */
  async setExternalMediaTracks(
    tracks: {
      videoTrack: MediaStreamTrack;
      audioTrack?: MediaStreamTrack
    }
  ): Promise<void> {
    this.requireClient();
    if (this.camera || this.cameraSource || this.microphone || this.externalVideo) {
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
          encoderConfig: "music_standard"
        });
      }
      this.externalVideo = wrappedVideo;
      this.externalAudio = wrappedAudio;
    } catch (error) {
      wrappedVideo?.close();
      wrappedAudio?.close();
      video.stop();
      audio?.stop();
      throw this.mapError(error);
    }
  }

  /**
   * Configures camera senders directly and uses Agora encoding configuration for external video.
   */
  async configureVideoEncoding(
    config: VideoEncodingConfiguration
  ): Promise<void> {
    const camera = this.requireLocalVideo();
    if (camera === this.camera) {
      const client = this.requireClient(), version = this.roomVersion;
      const published = this.videoPublishRequested;
      await this.run(() => this.queueSenderUpdate(async () => {
        const ensureActive = () => {
          if (this.camera !== camera || this.client !== client || this.roomVersion !== version ||
            (published && !this.videoPublishRequested)) {
            throw this.cancelled();
          }
        };
        ensureActive();
        if (this.videoPublishRequested) {
          await AgoraVideoSender.apply(
            camera,
            this.cameraEncodingConfiguration(config),
            ensureActive
          );
        }
        // Only target settings exist before publication; the sender becomes available after publish completes.
        this.cameraSenderConfiguration = { ...config };
      }));
      return;
    }
    const encodingSize = config;
    await this.run(async () => {
      await camera.setEncoderConfiguration({
        width: encodingSize.width,
        height: encodingSize.height,
        frameRate: config.frameRate,
        bitrateMin: config.minimumBitrate,
        bitrateMax: config.maximumBitrate,
      });
      if (this.appliedOptimizationModes.get(camera) !== config.encoderPreference) {
        await camera.setOptimizationMode(
          config.encoderPreference === RtcVideoEncoderPreference.maintainFramerate ? "motion" : "detail"
        );
        this.appliedOptimizationModes.set(
          camera,
          config.encoderPreference
        );
      }
    });
  }

  /**
   * Serializes camera sender changes to preserve update order.
   */
  private queueSenderUpdate(
    operation: () => Promise<void>
  ): Promise<void> {
    const next = this.senderUpdateTail.then(operation);
    this.senderUpdateTail = next.catch(() => { });
    return next;
  }

  /**
   * Restores the latest successful settings after publication or sender replacement without capturing
   * obsolete queued settings.
   */
  private restoreCameraSender(
    camera: ILocalVideoTrack
  ): Promise<void> {
    const client = this.client, version = this.roomVersion;
    return this.queueSenderUpdate(async () => {
      const ensureActive = () => {
        if (this.camera !== camera || this.client !== client || this.roomVersion !== version || !this.videoPublishRequested) {
          throw this.cancelled();
        }
      };
      ensureActive();
      const config = this.cameraSenderConfiguration;
      if (config) {
        await AgoraVideoSender.apply(
          camera,
          this.cameraEncodingConfiguration(config),
          ensureActive
        );
      }
    });
  }

  /**
   * Resolves camera encoding dimensions for the current orientation.
   */
  private cameraEncodingConfiguration(
    config: VideoEncodingConfiguration
  ): VideoEncodingConfiguration {
    // Canvas output already has the target orientation and must not receive native mobile transposition again.
    return this.cameraRotation ? config : {
      ...config,
      ...rtcOrientedVideoSize(config)
    };
  }

  /**
   * Removes sender-change observation and clears encoding settings.
   */
  private releaseCameraSender(): void {
    if (this.cameraTransceiverListener) {
      this.camera?.off(
        "transceiver-updated",
        this.cameraTransceiverListener
      );
    }
    this.cameraTransceiverListener = undefined;
    this.cameraSenderConfiguration = undefined;
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
    await this.run(() => client.join(
      configuration.appID,
      configuration.roomID,
      configuration.roomToken,
      configuration.userID
    ));
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
   * Rejoins with updated credentials, reusing capture tracks and restoring remote audio subscriptions.
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
    await this.run(() => client.join(
      config.appID,
      config.roomID,
      config.roomToken,
      config.userID
    ));
    if (!this.isRoomCurrent(
      client,
      version
    )) {
      // A join completing after leave or destroy must release the connection it just created.
      await this.run(() => client.leave());
      throw this.cancelled();
    }

    const video = this.externalVideo ?? this.camera;
    const audio = this.externalVideo ? this.externalAudio : this.microphone;
    if (this.videoPublishRequested && video) {
      await this.run(() => client.publish(video));
      this.ensureRoomCurrent(
        client,
        version
      );
      if (video === this.camera) {
        await this.restoreCameraSender(this.camera);
      }
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
    if (camera === this.camera) {
      await this.run(() => this.restoreCameraSender(this.camera!));
    }
  }

  /**
   * Unpublishes video while retaining capture and preview.
   */
  async unpublishLocalVideo(): Promise<void> {
    this.videoPublishRequested = false;
    if (this.rejoinTask || this.tokenExpired) {
      return;
    }
    const video = this.externalVideo ?? this.camera;
    if (this.client && video) {
      await this.run(() => this.client!.unpublish(video));
    }
  }

  /**
   * Publishes external audio only when supplied, or starts microphone capture for a camera source;
   * obsolete capture results are released.
   */
  async publishLocalAudio(): Promise<void> {
    const client = this.requireClient();
    this.audioPublishRequested = true;
    await this.rejoinOperation;
    const version = this.roomVersion;
    if (client !== this.client || !this.audioPublishRequested) {
      throw this.cancelled();
    }
    if (this.externalVideo) {
      const audio = this.externalAudio;
      if (audio && !client.localTracks.includes(audio)) {
        await this.run(() => client.publish(audio));
      }
      return;
    }
    try {
      if (!this.microphone) {
        const track = await this.sdk!.createMicrophoneAudioTrack();
        if (client !== this.client || version !== this.roomVersion) {
          track.close();
          throw this.cancelled();
        }
        this.microphone = track;
      }
      if (!client.localTracks.includes(this.microphone)) {
        await client.publish(this.microphone);
      }
    } catch (error) {
      throw this.mapError(
        error,
        XmaxErrorCode.microphonePermissionDenied
      );
    }
  }

  /**
   * Unpublishes audio while leaving capture cleanup to closure.
   */
  async unpublishLocalAudio(): Promise<void> {
    this.audioPublishRequested = false;
    if (this.rejoinTask || this.tokenExpired) {
      return;
    }
    const audio = this.externalVideo ? this.externalAudio : this.microphone;
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
  ): Promise<void> {
    const version = this.roomVersion;
    const client = this.client;
    const bytes = new TextEncoder().encode(message).byteLength;
    if (!client || !this.connection || (this.tokenExpired && !this.rejoinOperation)) {
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
      message
    };
    if (delivery === "latest") {
      this.latestMessage = pending;
      this.scheduleRoomMessages();
      return;
    }

    // Task controls form a barrier; ordinary ordered messages such as heartbeats retain the latest interaction position.
    if (delivery === "barrier") {
      this.latestMessage = undefined;
    }
    return new Promise<void>((
      resolve,
      reject
    ) => {
      pending.completion = {
        resolve,
        reject
      };
      this.orderedMessages.push(pending);
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
   * Serializes control acknowledgments while bounding concurrent snapshot sends without waiting for each
   * preceding response.
   */
  private async drainRoomMessages(
    drain: object,
  ): Promise<void> {
    try {
      while (this.messageDrain === drain) {
        const pending = this.orderedMessages[0] ?? this.latestMessage;
        if (!pending || (!pending.completion && this.activeSends.size >= 30)) {
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
            pending.message
          );
          if (pending.completion) {
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
    message: string
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
   * Clears room state, playback, and queues without stopping local video capture.
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
   * Returns the active original camera capture track.
   */
  private requireCamera(): ICameraVideoTrack {
    if (!this.cameraSource || !this.camera) {
      throw new XmaxError(
        XmaxErrorCode.invalidConfiguration,
        "Camera capture is not running"
      );
    }
    return this.cameraSource;
  }

  /**
   * Returns a publishable local video track from either camera or external media.
   */
  private requireLocalVideo(): ILocalVideoTrack {
    const video = this.externalVideo ?? this.camera;
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
    error: unknown,
    permissionCode?: XmaxErrorCode
  ): XmaxError {
    if (error instanceof XmaxError) {
      return error;
    }
    const code = typeof error === "object" && error !== null && "code" in error ? String(error.code) : "UNKNOWN";
    const safeCode = /^[A-Z_0-9-]+$/.test(code) ? code : "UNKNOWN";
    return new XmaxError(
      permissionCode && safeCode === "PERMISSION_DENIED" ? permissionCode : XmaxErrorCode.rtcError,
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
