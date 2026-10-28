//
//  XmaxRealtimeManager.ts
//  XmaxSDK
//
//  Author: 翁跃庭 (Yueting Weng)
//  GitHub: https://github.com/Xmax-AI/XmaxSDK-Web
//
//  Copyright (c) 2026 XMAX.AI PTE. LTD.
//

import { XmaxError, XmaxErrorCode } from "../../Foundation/Errors/XmaxError";
import { XmaxLogger } from "../../Foundation/Logging/XmaxLogger";
import { CameraPosition } from "../../Foundation/Media/Camera/CameraPosition";
import { alignedVideoSize } from "../../Foundation/Media/Video/VideoSize";
import { watchMediaPermissionPrompt } from "../../Foundation/Permissions/MediaPermissionWatch";
import { RtcProvider } from "../../Foundation/RTC/RtcProvider";
import { snapshotExtraParams, type RealtimeExtraParams } from "../../Service/Realtime/RealtimeExtraParams";
import type { RealtimeNetworkQuality, RealtimeNetworkQualityListener } from "../../Service/Realtime/RealtimeNetworkQuality";
import type {
  DownlinkVideoStatistics,
  DownlinkVideoStatisticsListener,
  UplinkVideoStatistics,
  UplinkVideoStatisticsListener
} from "../../Foundation/RTC/VideoStatistics";
import { RemoteMediaFrameController } from "../../Render/Video/RemoteMediaFrameController";
import type { RealtimeMediaFrameListener } from "../../Service/Realtime/RealtimeMediaFrame";
import type { RemoteMediaTracks } from "../../Foundation/Media/RemoteMediaTracks";
import type { MediaControlling } from "../../Media/MediaControlling";
import type { RenderControlling } from "../../Render/RenderControlling";
import { resolutionBuckets, supportedVideoFormats, type ModelSize } from "../../Service/Realtime/RealtimeModel";
import type { MediaService } from "../../Service/Media/MediaService";
import { RealtimeContext } from "../../Service/Realtime/RealtimeContext";
import { RealtimeMediaStream } from "../../Service/Realtime/RealtimeMediaStream";
import {
  RealtimeConnectionState,
  RealtimeState,
  type RealtimeStateListener,
} from "../../Service/Realtime/RealtimeState";
import { RealtimeVideoTrack } from "../../Service/Realtime/RealtimeVideoTrack";
import type { RealtimeVideoFormat } from "../../Service/Realtime/RealtimeVideoFormat";
import type { QualityController } from "../../Stream/Quality/QualityController";
import { qualityVideoFormat, qualityVideoMaximumSize, supportsQualityEncoding } from "../../Stream/Quality/QualityVideoFormat";
import { QUALITY_TIERS } from "../../Stream/Quality/QualityTiers";
import type { QualityHistory } from "../../Stream/Quality/QualityHistory";
import type { StreamControlling } from "../../Stream/StreamControlling";
import type { RealtimeConfiguration } from "./RealtimeConfiguration";
import { XmaxRealtimeFactory, type XmaxRealtimeDependencies } from "./XmaxRealtimeFactory";
import {
  type XmaxRealtimeLifecycleManager,
  RealtimeOperationKind,
  RealtimeTerminationScope,
  type RealtimeCleanupResult,
  type RealtimeOperationToken,
} from "./XmaxRealtimeLifecycleManager";
import type { XmaxRealtimeErrorManager } from "./XmaxRealtimeErrorManager";
import { RealtimeTiming } from "../../Service/Realtime/RealtimeTiming";
import type { RealtimeTimingListener } from "../../Service/Realtime/RealtimeTimingSnapshot";
import type { XmaxRealtimeManaging } from "./XmaxRealtimeManaging";
import { RealtimeCameraPreset, cameraPresetSize } from "../../Service/Realtime/RealtimeCameraPreset";
import { RealtimeQualityLevel } from "../../Stream/Quality/RealtimeQualityLevel";
import type { XmaxRealtimeConnectionManager } from "./XmaxRealtimeConnectionManager";
import type { XmaxRealtimeGenerationManager } from "./XmaxRealtimeGenerationManager";

/**
 * The remote first-frame wait limit, in milliseconds; timeout logs a warning without failing generation.
 */
const REMOTE_FIRST_FRAME_TIMEOUT_MS = 5_000;

/**
 * The original L1 baseline and active quality level. Automatic adaptation does not replace the baseline.
 */
interface QualityState {

  /**
   * The fixed format used to derive quality dimensions and frame rate.
   */
  readonly baseline: RealtimeVideoFormat;

  /**
   * The applied level, from 1 to 5.
   */
  level: number;
}

/**
 * Task-bound downlink state whose dimensions describe the submitted target, not received media.
 */
interface DownlinkQualityState extends QualityState {

  /**
   * The current generation task ID.
   */
  readonly taskID: string;

  /**
   * The submitted target dimensions, in pixels.
   */
  size: ModelSize;
}

/**
 * Coordinates public realtime APIs, local media, connections, and generation.
 *
 * Capture and transport share an RTC engine. Session services maintain heartbeats; connection and
 * generation managers own their resources, while the coordinator owns public state, operation leases,
 * and cancellation.
 */
export class XmaxRealtimeManager implements XmaxRealtimeManaging {

  /**
   * The realtime generation configuration.
   */
  readonly options: RealtimeConfiguration;

  /**
   * The media-sizing and platform-capability service.
   */
  private readonly mediaService: MediaService;

  /**
   * The on-demand original remote frame observer, without recording or file muxing.
   */
  private readonly remoteMediaFrames = new RemoteMediaFrameController();

  /**
   * The original-track observer, independent of WebCodecs.
   */
  private remoteMediaTracksListener?: (
    tracks?: RemoteMediaTracks
  ) => void;

  /**
   * Whether decoded remote-frame observation currently needs original tracks.
   */
  private remoteMediaFrameObservation = false;

  /**
   * Whether this RTC provider can observe audio independently of playback volume.
   */
  private readonly canReadRemoteAudio: boolean;

  /**
   * The fixed media format resolved at source creation, unaffected by uplink, generation-canvas, or
   * downlink changes.
   */
  private resolvedMediaVideoFormat?: RealtimeVideoFormat;

  /**
   * The coordinator owning lifecycle admission, state, and cleanup.
   */
  private readonly lifecycleManager: XmaxRealtimeLifecycleManager;

  /**
   * The handler for asynchronous realtime failures.
   */
  private readonly errorManager: XmaxRealtimeErrorManager;

  /**
   * The active media source and interaction sampling controller.
   */
  private readonly mediaController: MediaControlling;

  /**
   * The remote-track, warmup, and interaction-view binding controller.
   */
  private readonly renderController: RenderControlling;

  /**
   * The startup-stage timing observer.
   */
  private readonly timing = new RealtimeTiming();

  /**
   * The callback ending first-frame timing when a remote frame is submitted for display.
   */
  private remoteFrameDisplayHandler?: () => void;

  /**
   * The callback recording completed render warmup and presentation readiness.
   */
  private remoteRenderWarmupCompletedHandler?: () => void;

  /**
   * The disposer for media-permission observation.
   */
  private permissionWatchDispose?: () => void;

  /**
   * The latest local-video statistics snapshot.
   */
  private localVideoStatistics?: UplinkVideoStatistics;

  /**
   * The app's local-video statistics listener.
   */
  private localVideoStatisticsListener?: UplinkVideoStatisticsListener;

  /**
   * The current result stream's video statistics.
   */
  private remoteVideoStatistics?: DownlinkVideoStatistics;

  /**
   * The app's remote-video statistics listener.
   */
  private remoteVideoStatisticsListener?: DownlinkVideoStatisticsListener;

  /**
   * Whether local publication has enabled valid video statistics.
   */
  private acceptsVideoStatistics = false;

  /**
   * The latest uplink and downlink network quality snapshot.
   */
  private networkStatistics?: RealtimeNetworkQuality;

  /**
   * The app's network quality listener.
   */
  private networkStatisticsListener?: RealtimeNetworkQualityListener;

  /**
   * The owner of session and RTC connection resources.
   */
  private readonly connectionManager: XmaxRealtimeConnectionManager;

  /**
   * The owner of generation signaling, confirmation, and cached conditions.
   */
  private readonly generationManager: XmaxRealtimeGenerationManager;

  /**
   * The controller for room transport, publication, subscriptions, and generation signaling.
   */
  private readonly streamController: StreamControlling;

  /**
   * The uplink quality-adaptation state machine.
   */
  private readonly qualityController?: QualityController;

  /**
   * The locally persisted history of successful quality levels.
   */
  private readonly qualityHistory?: QualityHistory;

  /**
   * Each local track's fixed quality baseline and current level.
   */
  private readonly qualityStates = new WeakMap<RealtimeVideoTrack, QualityState>();

  /**
   * The downlink quality-adaptation state machine.
   */
  private readonly downlinkQualityController?: QualityController;

  /**
   * The last successfully sent downlink level and dimensions, without a server-application
   * acknowledgment.
   */
  private downlinkQualityState?: DownlinkQualityState;

  /**
   * Whether an adaptive-quality update is in progress.
   */
  private adaptiveQualityPending = false;

  /**
   * The adaptation revision used to reject obsolete task results.
   */
  private adaptiveQualityRevision = 0;

  /**
   * The local media preview volume, from 0 to 1.
   */
  private storedLocalAudioVolume = 1;

  /**
   * The remote playback volume, from 0 to 1.
   */
  private storedRemoteAudioVolume = 0;

  /**
   * Creates a realtime manager.
   *
   * @param options - The realtime model and generation configuration.
   * @param dependencies - Optional service and controller replacements; capture and transport share one
   * RTC engine.
   */
  constructor(
    options: RealtimeConfiguration,
    dependencies?: XmaxRealtimeDependencies
  ) {
    this.options = options;

    const components = XmaxRealtimeFactory.make(
      options,
      dependencies,
      this.timing,
      {
        clearRemoteVideoStatistics: () => this.clearRemoteVideoStatistics(),
        onFrameDisplayed: () => this.remoteFrameDisplayHandler?.(),
        onRenderWarmupCompleted: () => this.remoteRenderWarmupCompletedHandler?.(),
        completeGenerationPresentation: () => this.completeGenerationPresentation(),
        remoteAudioVolume: () => this.storedRemoteAudioVolume,
        onHeartbeatFailure: (
          sessionID,
          error
        ) => this.handleHeartbeatFailure(
          sessionID,
          error
        ),
        cleanup: (
          scope,
          taskID
        ) => this.performCleanup(
          scope,
          taskID
        ),
        applyUplinkQuality: (
          level,
          token,
          signal
        ) => this.applyUplinkQuality(
          level,
          token,
          signal
        ),
        applyDownlinkQuality: (
          level,
          token,
          signal
        ) => this.applyDownlinkQuality(
          level,
          token,
          signal
        ),
        supportsUplinkQuality: level => {
          const track = this.currentLocalTrack;
          const state = track && this.qualityStates.get(track);
          return !!state && supportsQualityEncoding(this.uplinkQualityFormat(
            state.baseline,
            level
          ));
        },
      }
    );

    this.mediaService = components.mediaService;
    this.errorManager = components.errorManager;
    this.canReadRemoteAudio = components.canReadRemoteAudio;
    this.streamController = components.streamController;
    this.mediaController = components.mediaController;
    this.renderController = components.renderController;
    this.connectionManager = components.connectionManager;
    this.generationManager = components.generationManager;
    this.lifecycleManager = components.lifecycleManager;
    this.qualityHistory = components.qualityHistory;
    this.qualityController = components.qualityController;
    this.downlinkQualityController = components.downlinkQualityController;

    XmaxRealtimeFactory.bindStatistics(
      this.streamController,
      {
        uplink: (statistics) => {
          if (this.acceptsVideoStatistics) {
            this.localVideoStatistics = statistics ? Object.freeze({ ...statistics }) : undefined;
            this.notifyLocalVideoStatistics();
          }
        },
        network: (statistics) => {
          if (this.acceptsVideoStatistics) {
            this.networkStatistics = statistics ? Object.freeze({ ...statistics }) : undefined;
            this.handleAdaptiveQuality(statistics);
            this.notifyNetworkStatistics();
          }
        },
        downlink: (statistics) => {
          if (this.acceptsVideoStatistics) {
            this.remoteVideoStatistics = statistics ? Object.freeze({ ...statistics }) : undefined;
            this.notifyRemoteVideoStatistics();
          }
        },
      }
    );
  }

  /**
   * The current realtime connection and generation state.
   */
  get currentState(): RealtimeState {
    return this.lifecycleManager.currentState;
  }

  /**
   * The fixed camera media format, independent of adapted uplink dimensions.
   */
  get currentCameraVideoFormat(): RealtimeVideoFormat | undefined {
    return this.mediaController.source === "camera"
      ? this.resolvedMediaVideoFormat ?? this.currentLocalTrack?.videoFormat
      : undefined;
  }

  /**
   * The preset matching camera media dimensions, independent of encoding frame rate or quality level.
   */
  get currentCameraPreset(): RealtimeCameraPreset | undefined {
    const format = this.currentCameraVideoFormat;
    return format && Object.values(RealtimeCameraPreset).find(preset => {
      const size = cameraPresetSize(preset);
      return size.width === format.width && size.height === format.height;
    });
  }

  /**
   * The uplink level successfully applied to the active connection.
   */
  get uplinkQualityLevel(): RealtimeQualityLevel | undefined {
    const track = this.currentLocalTrack;
    const state = this.currentState.connectionState;
    return (state === RealtimeConnectionState.connected ||
      state === RealtimeConnectionState.starting || state === RealtimeConnectionState.generating) && track
      ? this.qualityStates.get(track)?.level as RealtimeQualityLevel | undefined
      : undefined;
  }

  /**
   * The downlink level successfully submitted for the active connection.
   */
  get downlinkQualityLevel(): RealtimeQualityLevel | undefined {
    const state = this.currentState.connectionState;
    return state === RealtimeConnectionState.connected ||
      state === RealtimeConnectionState.starting || state === RealtimeConnectionState.generating
      ? this.downlinkQualityState?.level as RealtimeQualityLevel | undefined
      : undefined;
  }

  /**
   * Updates a disconnected camera within a media operation and resets quality baselines after success.
   */
  async updateCameraFormat(
    format: RealtimeVideoFormat | RealtimeCameraPreset
  ): Promise<void> {
    await this.lifecycleManager.run(
      RealtimeOperationKind.media,
      undefined,
      async token => {
        const current = this.currentCameraVideoFormat;
        if (this.currentState.connectionState !== RealtimeConnectionState.ready ||
          this.connectionManager.currentSessionID || !current) {
          throw new XmaxError(
            XmaxErrorCode.invalidConfiguration,
            "Camera preview must be ready and disconnected before updating its format"
          );
        }

        const size = typeof format === "string" ? cameraPresetSize(format) : undefined;
        const requested = size ? current.resized(
          size.width,
          size.height
        ) : format as RealtimeVideoFormat;
        if (!requested || typeof requested.validate !== "function") {
          throw new XmaxError(
            XmaxErrorCode.invalidConfiguration,
            "A camera format or preset is required"
          );
        }
        token.ensureCurrent();
        await this.mediaController.updateCameraFormat(requested);
        token.ensureCurrent();
        const track = this.currentLocalTrack!;
        this.resolvedMediaVideoFormat = track.videoFormat;
        this.qualityStates.delete(track);
      }
    );
  }

  /**
   * Sets the uplink level and resumes automatic adaptation from it.
   */
  setUplinkQualityLevel(
    level: RealtimeQualityLevel
  ): Promise<void> {
    return this.updateQualityLevel(
      level,
      false,
      true
    );
  }

  /**
   * Sets the downlink level through the target-dimensions signaling path.
   */
  setDownlinkQualityLevel(
    level: RealtimeQualityLevel
  ): Promise<void> {
    return this.updateQualityLevel(
      level,
      true,
      true
    );
  }

  /**
   * Adjusts uplink quality while retaining the baseline and continuing enabled adaptation.
   *
   * @param direction - The adjustment direction; L1/L5 boundaries do not reapply the same level.
   */
  async adjustUplinkQuality(
    direction: "upgrade" | "downgrade"
  ): Promise<void> {
    return this.updateQualityLevel(
      direction,
      false
    );
  }

  /**
   * Applies uplink quality and updates track metadata and history after success.
   */
  private async applyUplinkQuality(
    level: number,
    token: RealtimeOperationToken,
    signal?: AbortSignal
  ): Promise<void> {
    const track = this.currentLocalTrack;
    const state = track && this.qualityStates.get(track);
    const ensureActive = () => {
      token.ensureCurrent();
      if (signal?.aborted || !track || !state || track !== this.currentLocalTrack ||
        state !== this.qualityStates.get(track) || this.currentState.connectionState !== RealtimeConnectionState.generating) {
        throw new XmaxError(
          XmaxErrorCode.cancelled,
          "Adaptive video format update was cancelled"
        );
      }
    };

    ensureActive();
    if (!track || !state) {
      return;
    }

    const target = this.uplinkQualityFormat(
      state.baseline,
      level
    );
    let format: RealtimeVideoFormat;
    if (this.options.provider === RtcProvider.trtc) {
      // TRTC changes frame rate only, retaining the applied dimensions, bitrate, and encoding preference.
      format = await this.streamController.updateUplinkFrameRate(target.fps);
    } else {
      await this.streamController.updateUplinkVideoFormat(target);
      format = target;
    }
    ensureActive();

    // Uplink adaptation must not alter generation, downlink dimensions, or the original L1 baseline.
    this.resolvedMediaVideoFormat ??= state.baseline;
    track.updateVideoFormat(format);
    state.level = level;
    this.qualityHistory?.write(
      "uplink",
      level
    );
  }

  /**
   * Adjusts downlink quality through the shared target-size signaling path without changing generation
   * or uplink settings.
   */
  async adjustDownlinkQuality(
    direction: "upgrade" | "downgrade"
  ): Promise<void> {
    return this.updateQualityLevel(
      direction,
      true
    );
  }

  /**
   * Serializes explicit and incremental quality changes, retaining the last successful level on failure.
   */
  private async updateQualityLevel(
    requested: RealtimeQualityLevel | "upgrade" | "downgrade",
    downlink: boolean,
    absolute = false
  ): Promise<void> {
    await this.lifecycleManager.run(
      RealtimeOperationKind.configuration,
      undefined,
      async token => {
        const track = this.currentLocalTrack;
        const state = downlink ? this.downlinkQualityState : track && this.qualityStates.get(track);
        if (!state || this.currentState.connectionState !== RealtimeConnectionState.generating) {
          throw new XmaxError(
            XmaxErrorCode.invalidConfiguration,
            "Quality adjustment requires an active generation"
          );
        }

        let level = NaN;
        if (absolute) {
          if (typeof requested === "number") {
            level = requested;
          }
        } else if (requested === "upgrade" || requested === "downgrade") {
          const step = requested === "upgrade" ? -1 : 1;
          level = Math.max(1, Math.min(Object.keys(QUALITY_TIERS).length, state.level + step));
        }
        if (!Number.isInteger(level) || level < 1 || level > Object.keys(QUALITY_TIERS).length) {
          throw new XmaxError(
            XmaxErrorCode.invalidConfiguration,
            "Unsupported quality level or direction"
          );
        }
        if (level === state.level) {
          return;
        }
        if (!downlink && !supportsQualityEncoding(this.uplinkQualityFormat(
          state.baseline,
          level
        ))) {
          throw new XmaxError(
            XmaxErrorCode.invalidConfiguration,
            "Quality level conflicts with explicit bitrate constraints"
          );
        }

        this.adaptiveQualityRevision++;
        const controller = downlink ? this.downlinkQualityController : this.qualityController;
        controller?.resetSamples();
        if (downlink) {
          await this.applyDownlinkQuality(
            level,
            token
          );
        } else {
          await this.applyUplinkQuality(
            level,
            token
          );
        }
        controller?.start(level);
      }
    );
  }

  /**
   * Sends target downlink dimensions and updates the level after success.
   */
  private async applyDownlinkQuality(
    level: number,
    token: RealtimeOperationToken,
    signal?: AbortSignal
  ): Promise<void> {
    const state = this.downlinkQualityState;
    const ensureActive = () => {
      token.ensureCurrent();
      if (signal?.aborted || !state || state !== this.downlinkQualityState ||
        this.currentState.connectionState !== RealtimeConnectionState.generating || this.currentState.taskID !== state.taskID) {
        throw new XmaxError(
          XmaxErrorCode.cancelled,
          "Target size update was cancelled"
        );
      }
    };
    ensureActive();
    if (!state) {
      return;
    }
    const size = this.resolveTargetSize(
      state.baseline,
      level
    );
    await this.streamController.updateDownlinkVideoResolution(
      state.taskID,
      size,
      ensureActive
    );
    ensureActive();
    state.level = level;
    state.size = size;
    this.qualityHistory?.write(
      "downlink",
      level
    );
  }

  /**
   * The local media preview volume, from 0 to 1.
   */
  get localAudioVolume(): number {
    return this.storedLocalAudioVolume;
  }

  /**
   * The remote generated audio volume, from 0 to 1.
   */
  get remoteAudioVolume(): number {
    return this.storedRemoteAudioVolume;
  }

  /**
   * Sets the state listener and immediately replays the current state.
   *
   * @param listener - The callback; undefined removes it.
   */
  async setStateListener(
    listener?: RealtimeStateListener
  ): Promise<void> {
    await this.lifecycleManager.setStateListener(listener);
  }

  /**
   * Sets the startup timing listener and immediately replays the snapshot; undefined removes it.
   */
  async setTimingListener(
    listener?: RealtimeTimingListener
  ): Promise<void> {
    this.timing.setListener(listener);
  }

  /**
   * Observes local main-stream video statistics and immediately replays the latest snapshot.
   */
  async setUplinkVideoStatisticsListener(
    listener?: UplinkVideoStatisticsListener
  ): Promise<void> {
    this.localVideoStatisticsListener = listener;
    this.notifyLocalVideoStatistics();
  }

  /**
   * Observes result-stream video statistics and immediately replays the latest snapshot.
   */
  async setDownlinkVideoStatisticsListener(
    listener?: DownlinkVideoStatisticsListener
  ): Promise<void> {
    this.remoteVideoStatisticsListener = listener;
    this.notifyRemoteVideoStatistics();
  }

  /**
   * Replays remote statistics while isolating synchronous and asynchronous observer failures.
   */
  private notifyRemoteVideoStatistics(): void {
    try {
      void Promise.resolve(this.remoteVideoStatisticsListener?.(this.remoteVideoStatistics)).catch(() => { });
    } catch {
      // Statistics observers must not interrupt generation or resource cleanup.
    }
  }

  /**
   * Replays the latest network snapshot, or undefined without data or after disconnection.
   */
  async setNetworkQualityListener(
    listener?: RealtimeNetworkQualityListener
  ): Promise<void> {
    this.networkStatisticsListener = listener;
    this.notifyNetworkStatistics();
  }

  /**
   * Replays network statistics while isolating synchronous and asynchronous observer failures.
   */
  private notifyNetworkStatistics(): void {
    try {
      void Promise.resolve(this.networkStatisticsListener?.(this.networkStatistics)).catch(() => { });
    } catch {
      // Statistics observers must not interrupt generation or resource cleanup.
    }
  }

  /**
   * Clears remote statistics and notifies observers only if a snapshot previously existed.
   */
  private clearRemoteVideoStatistics(): void {
    const hadStatistics = this.remoteVideoStatistics !== undefined;
    this.remoteVideoStatistics = undefined;
    if (hadStatistics) {
      this.notifyRemoteVideoStatistics();
    }
  }

  /**
   * Replays local statistics while isolating synchronous and asynchronous observer failures.
   */
  private notifyLocalVideoStatistics(): void {
    try {
      void Promise.resolve(this.localVideoStatisticsListener?.(this.localVideoStatistics)).catch(() => { });
    } catch {
      // Statistics observers must not interrupt capture, generation, or resource cleanup.
    }
  }

  /**
   * Stops statistics collection and clears snapshots, notifying only observers whose data became
   * invalid.
   */
  private clearVideoStatistics(): void {
    this.qualityController?.stop();
    this.downlinkQualityController?.stop();
    this.downlinkQualityState = undefined;
    this.adaptiveQualityRevision++;
    this.acceptsVideoStatistics = false;

    const hadNetworkStatistics = this.networkStatistics !== undefined;
    this.networkStatistics = undefined;
    if (hadNetworkStatistics) {
      this.notifyNetworkStatistics();
    }

    this.clearRemoteVideoStatistics();

    const hadStatistics = this.localVideoStatistics !== undefined;
    this.localVideoStatistics = undefined;
    if (hadStatistics) {
      this.notifyLocalVideoStatistics();
    }
  }

  /**
   * Sets local media preview volume.
   *
   * @param volume - The preview volume, from 0 to 1.
   * @throws Rejects if the volume is outside the valid range.
   */
  async setLocalAudioVolume(
    volume: number
  ): Promise<void> {
    XmaxRealtimeManager.validateVolume(volume);
    this.storedLocalAudioVolume = volume;
  }

  /**
   * Sets remote playback volume, storing it before subscription and applying it before playback begins.
   *
   * @param volume - The remote volume, from 0 to 1.
   * @throws Rejects for an invalid volume or failed RTC update.
   */
  async setRemoteAudioVolume(
    volume: number
  ): Promise<void> {
    XmaxRealtimeManager.validateVolume(volume);
    this.storedRemoteAudioVolume = volume;
    if (!this.connectionManager.currentSessionID) {
      return;
    }
    try {
      this.streamController.setRemoteAudioVolume(volume);
    } catch (error) {
      throw XmaxError.from(error);
    }
  }

  /**
   * Creates a local camera stream and starts preview.
   *
   * Bind the returned track to a preview view; ready is entered after a valid frame arrives and the view
   * is bound.
   *
   * @param options.position - The front or rear camera.
   * @param options.useMicrophone - Whether to capture and publish microphone audio.
   * @param options.rotation - Clockwise input rotation, defaulting to 0; nonzero rotation currently
   * requires Agora. Preview and upload are corrected independently of mirroring.
   * @param options.enableFrameValidation - Whether to wait for a fixed 200 ms camera warmup before
   * publishing; defaults to true. False skips the wait.
   * @param options.videoFormat - The post-rotation target format, resolved using model sizing rules.
   * @param options.preset - A preset with the recommended frame rate, instead of videoFormat. Supply
   * exactly one.
   * @returns A media stream containing the local camera video track.
   * @throws Rejects for unsupported camera input, invalid configuration, denied permission, or capture
   * startup failure.
   */
  async createLocalCameraStream(
    options: Parameters<XmaxRealtimeManaging["createLocalCameraStream"]>[0]
  ): Promise<RealtimeMediaStream> {
    return this.lifecycleManager.run(
      RealtimeOperationKind.media,
      undefined,
      async (token) => {
        this.mediaController.ensureNoLocalSource();
        const { preset, videoFormat, ...captureOptions } = options;
        if ((preset === undefined) === (videoFormat === undefined)) {
          throw new XmaxError(
            XmaxErrorCode.invalidConfiguration,
            "Provide either a camera preset or a video format, not both"
          );
        }

        let requestedFormat = videoFormat;
        if (preset !== undefined) {
          const size = cameraPresetSize(preset);
          requestedFormat = supportedVideoFormats(this.options.model).find(format =>
            format.width === size.width && format.height === size.height,
          );
        }
        if (!requestedFormat) {
          throw new XmaxError(
            XmaxErrorCode.invalidConfiguration,
            "Model does not support the requested camera preset"
          );
        }
        const cameraOptions = {
          ...captureOptions,
          videoFormat: requestedFormat
        };

        await this.lifecycleManager.commit(
          new RealtimeState({
            connectionState: RealtimeConnectionState.preparing,
          }),
          token,
        );
        token.ensureCurrent();

        const completeCamera = this.timing.startCamera();
        this.clearVideoStatistics();

        // Observe permission decisions independently from camera startup.
        // Microphone permission may be requested during connection; retain observation until capture stops.
        this.disposePermissionWatch();
        const permissionWatch = await watchMediaPermissionPrompt(options?.useMicrophone ?? false);
        if (permissionWatch) {
          const completePermission = this.timing.startPermission();
          void permissionWatch.decided.then(() => completePermission()).catch(() => { });
          this.permissionWatchDispose = permissionWatch.dispose;
        }

        let stream: RealtimeMediaStream;
        try {
          token.ensureCurrent();
          stream = await this.mediaController.createLocalCameraStream(cameraOptions);
        } catch (error) {
          this.disposePermissionWatch();
          this.timing.cancel();
          throw error;
        }

        token.ensureCurrent();
        this.resolvedMediaVideoFormat = stream.videoTrack?.videoFormat;
        completeCamera();

        // Local readiness requires a valid frame and a bound preview.
        this.mediaController.setCameraPreviewReadyHandler((isCurrent) => {
          void this.lifecycleManager.localPreviewDidBecomeReady(isCurrent);
        });

        return stream;
      },
    );
  }

  /**
   * Creates a file-video source and prepares its external tracks, releasing media and RTC resources on
   * failure.
   *
   * @param options.file - A local File or Blob containing decodable video.
   * @param options.videoFormat - Frame rate and encoding settings; source dimensions are resolved from
   * the file.
   * @param options.loop - Whether to loop playback; defaults to true.
   * @param options.includeAudio - Whether to publish file audio; defaults to true.
   */
  async createLocalVideoStream(
    options: Parameters<XmaxRealtimeManaging["createLocalVideoStream"]>[0]
  ): Promise<RealtimeMediaStream> {
    return this.lifecycleManager.run(
      RealtimeOperationKind.media,
      undefined,
      async (token) => {
        this.mediaController.ensureNoLocalSource();
        this.mediaController.validateExternalMediaSupport("local");
        token.setFailureScope(RealtimeTerminationScope.all);
        this.timing.start();
        this.clearVideoStatistics();

        // Unlock playback before awaiting network or RTC initialization to preserve the user gesture.
        const stream = await this.mediaController.createLocalVideoStream(
          options,
          token.signal
        );
        token.ensureCurrent();
        await this.mediaController.prepareSource(() => token.ensureCurrent());

        this.resolvedMediaVideoFormat = stream.videoTrack?.videoFormat;
        await this.lifecycleManager.commit(
          new RealtimeState({ connectionState: RealtimeConnectionState.ready }),
          token
        );
        return stream;
      }
    );
  }

  /**
   * Creates a still-image video source and prepares RTC, releasing this operation's resources on failure
   * or cancellation.
   */
  async createLocalImageStream(
    options: Parameters<XmaxRealtimeManaging["createLocalImageStream"]>[0]
  ): Promise<RealtimeMediaStream> {
    return this.lifecycleManager.run(
      RealtimeOperationKind.media,
      undefined,
      async token => {
        this.mediaController.ensureNoLocalSource();
        this.mediaController.validateExternalMediaSupport("image");
        token.setFailureScope(RealtimeTerminationScope.all);
        this.timing.start();
        this.clearVideoStatistics();

        const stream = await this.mediaController.createLocalImageStream(
          options,
          token.signal
        );
        token.ensureCurrent();
        await this.mediaController.prepareSource(() => token.ensureCurrent());

        this.resolvedMediaVideoFormat = stream.videoTrack?.videoFormat;
        await this.lifecycleManager.commit(
          new RealtimeState({ connectionState: RealtimeConnectionState.ready }),
          token
        );
        return stream;
      }
    );
  }

  /**
   * Binds an external source or clones a compatibility video track without capturing devices.
   *
   * @param options - A source or videoTrack/videoFormat pair, never both.
   * @returns The resolved local stream; frame sources also support preview and optional audio.
   */
  async createExternalVideoStream(
    options: Parameters<XmaxRealtimeManaging["createExternalVideoStream"]>[0]
  ): Promise<RealtimeMediaStream> {
    return this.lifecycleManager.run(
      RealtimeOperationKind.media,
      undefined,
      async token => {
        this.mediaController.ensureNoLocalSource();

        this.mediaController.validateExternalMediaSupport("external");

        const stream = await this.mediaController.createExternalVideoStream(
          options,
          token.signal
        );
        token.setFailureScope(RealtimeTerminationScope.all);
        token.ensureCurrent();
        this.timing.start();
        this.clearVideoStatistics();

        await this.mediaController.prepareSource(() => token.ensureCurrent());

        this.resolvedMediaVideoFormat = stream.videoTrack?.videoFormat;
        await this.lifecycleManager.commit(
          new RealtimeState({ connectionState: RealtimeConnectionState.ready }),
          token
        );

        return stream;
      }
    );
  }

  /**
   * Unbinds a disconnected external source and clears media state without taking ownership of app
   * devices.
   */
  async stopExternalVideoStream(): Promise<void> {
    await this.lifecycleManager.run(
      RealtimeOperationKind.media,
      undefined,
      async token => {
        if (this.mediaController.source !== "externalVideo") {
          return;
        }

        if (this.connectionManager.currentSessionID) {
          throw new XmaxError(
            XmaxErrorCode.invalidConfiguration,
            "Disconnect before stopping the external video stream"
          );
        }

        token.setFailureScope(RealtimeTerminationScope.all);
        this.timing.cancel();
        this.clearVideoStatistics();
        await this.mediaController.stopLocalStream();
        token.ensureCurrent();

        this.resolvedMediaVideoFormat = undefined;
        await this.lifecycleManager.commit(
          new RealtimeState({ connectionState: RealtimeConnectionState.idle }),
          token
        );
      }
    );
  }

  /**
   * The media-source track owned by this manager.
   */
  private get currentLocalTrack(): RealtimeVideoTrack | undefined {
    return this.mediaController.currentTrack;
  }

  /**
   * Disposes media-permission observation when no longer needed.
   */
  private disposePermissionWatch(): void {
    this.permissionWatchDispose?.();
    this.permissionWatchDispose = undefined;
  }

  /**
   * Applies a complete uplink format and updates track metadata without changing generation dimensions
   * or lifecycle. Dimensions align downward to four pixels, preferring the exact aspect ratio; the
   * result becomes the new L1 baseline. Shared configuration admission excludes conflicting lifecycle
   * work.
   *
   * @throws Rejects without local media, for invalid settings, conflicting operations, or encoder-update
   * failure.
   */
  async updateUplinkVideoFormat(
    videoFormat: RealtimeVideoFormat
  ): Promise<void> {
    await this.lifecycleManager.run(
      RealtimeOperationKind.configuration,
      undefined,
      async (token) => {
        const track = this.currentLocalTrack;
        const previousFormat = track?.videoFormat;
        if (!track || !previousFormat) {
          throw new XmaxError(
            XmaxErrorCode.invalidConfiguration,
            "Local camera, external or file video stream is not started"
          );
        }
        videoFormat.validate();
        const size = alignedVideoSize(
          videoFormat,
          1,
          4
        );
        const resolvedFormat = size.width === videoFormat.width && size.height === videoFormat.height
          ? videoFormat : videoFormat.resized(
            size.width,
            size.height
          );
        this.qualityController?.stop();

        // Uplink dimensions do not snap to model buckets or send generation/target-size signaling.
        await this.streamController.updateUplinkVideoFormat(resolvedFormat);
        token.ensureCurrent();

        this.resolvedMediaVideoFormat ??= previousFormat;
        track.updateVideoFormat(resolvedFormat);
        this.qualityStates.set(
          track,
          {
            baseline: resolvedFormat,
            level: 1
          }
        );
        this.qualityHistory?.write(
          "uplink",
          1
        );
      }
    );
  }

  /**
   * Replaces only frame rate on an active connection using the shared configuration lease.
   */
  async updateUplinkFrameRate(
    fps: number
  ): Promise<void> {
    await this.lifecycleManager.run(
      RealtimeOperationKind.configuration,
      undefined,
      async (token) => {
        this.qualityController?.stop();
        await this.applyUplinkFrameRate(
          fps,
          token
        );
        const track = this.currentLocalTrack;
        if (track?.videoFormat) {
          this.qualityStates.set(
            track,
            {
              baseline: track.videoFormat,
              level: 1
            }
          );
          this.qualityHistory?.write(
            "uplink",
            1
          );
        }
      }
    );
  }

  /**
   * Applies a manual frame-rate update and establishes its full resulting format as the new L1 baseline.
   */
  private async applyUplinkFrameRate(
    fps: number,
    token: RealtimeOperationToken
  ): Promise<void> {
    const track = this.currentLocalTrack;
    const previous = track?.videoFormat;
    const state = this.currentState.connectionState;
    if (!track || !previous ||
      (state !== RealtimeConnectionState.connected && state !== RealtimeConnectionState.starting &&
        state !== RealtimeConnectionState.generating)) {
      throw new XmaxError(
        XmaxErrorCode.invalidConfiguration,
        "Frame rate updates require a connected local camera, external or file stream"
      );
    }
    if (!Number.isFinite(fps) || fps <= 0) {
      throw new XmaxError(
        XmaxErrorCode.invalidConfiguration,
        "Video frame rate must be greater than zero"
      );
    }
    const format = await this.streamController.updateUplinkFrameRate(fps);
    token.ensureCurrent();
    this.resolvedMediaVideoFormat ??= previous;
    track.updateVideoFormat(format);
  }

  /**
   * Evaluates both directions independently and applies one sample serially to avoid competing
   * configuration leases.
   */
  private handleAdaptiveQuality(
    statistics?: RealtimeNetworkQuality
  ): void {
    const revision = ++this.adaptiveQualityRevision;
    const controller = this.qualityController;
    const downlink = this.downlinkQualityController;
    if (!controller || !downlink) {
      return;
    }
    const taskID = this.currentState.taskID;
    if (this.currentState.connectionState !== RealtimeConnectionState.generating || !taskID) {
      controller.stop();
      downlink.stop();
      return;
    }
    if (!statistics || this.lifecycleManager.isBusy || this.adaptiveQualityPending) {
      controller.resetSamples();
      downlink.resetSamples();
      return;
    }
    const track = this.currentLocalTrack;
    if (!track) {
      controller.stop();
    } else if (!controller.snapshot.active) {
      const format = track.videoFormat;
      if (format) {
        const state = this.qualityStates.get(track) ?? {
          baseline: format,
          level: 1
        };
        this.qualityStates.set(
          track,
          state
        );
        controller.start(state.level);
      }
    }
    const state = this.downlinkQualityState;
    if (state && !downlink.snapshot.active) {
      downlink.start(state.level);
    }
    const sampleAt = performance.now();
    this.adaptiveQualityPending = true;
    void (async () => {
      // The coordinator reports failures; one direction's failure must not prevent the other direction's evaluation.
      await controller.observe(
        statistics.uplink,
        sampleAt
      ).catch(() => { });
      if (
        revision !== this.adaptiveQualityRevision || this.currentState.taskID !== taskID ||
        state !== this.downlinkQualityState ||
        this.currentState.connectionState !== RealtimeConnectionState.generating || this.lifecycleManager.isBusy
      ) {
        downlink.resetSamples();
        return;
      }
      await downlink.observe(
        statistics.downlink,
        sampleAt
      ).catch(() => { });
    })().finally(() => {
      this.adaptiveQualityPending = false;
    });
  }

  /**
   * Stops camera capture and releases preview and RTC resources.
   */
  async stopLocalCameraStream(): Promise<void> {
    if (this.mediaController.source && this.mediaController.source !== "camera") {
      return;
    }
    await this.lifecycleManager.run(
      RealtimeOperationKind.media,
      undefined,
      async (token) => {
        this.timing.cancel();
        this.clearVideoStatistics();
        this.disposePermissionWatch();
        await this.mediaController.stopLocalCameraStream();
        token.ensureCurrent();
        this.resolvedMediaVideoFormat = undefined;
        await this.lifecycleManager.commit(
          new RealtimeState({ connectionState: RealtimeConnectionState.idle }),
          token,
        );
      },
    );
  }

  /**
   * Switches between front and rear cameras.
   *
   * During generation, stops the task, switches capture, and restores generation with cached conditions
   * while retaining the RTC connection. Switching is unavailable during connection or generation
   * startup.
   *
   * @returns The local stream with the same SDK video track and updated camera position.
   */
  async switchCamera(): Promise<RealtimeMediaStream> {
    return this.lifecycleManager.run(
      RealtimeOperationKind.cameraSwitch,
      undefined,
      async (token) => {
        if (this.mediaController.source === "externalVideo") {
          throw new XmaxError(
            XmaxErrorCode.invalidConfiguration,
            "External video capture is managed by the caller"
          );
        }

        this.qualityController?.stop();
        const stream = await this.mediaController.switchCamera();
        token.ensureCurrent();
        return stream;
      },
    );
  }

  /**
   * Connects a local stream created by this manager.
   *
   * Creates a session, joins the RTC room, publishes local media, and starts heartbeats. Enabled camera
   * validation waits for a fixed 200 ms warmup in parallel with connection, before publishing. The
   * returned remote stream carries results once generation starts.
   *
   * @param localStream - This manager's camera, external, local-image, or file-video stream.
   * @returns A remote stream placeholder for generated media.
   * @throws Rejects for foreign streams, an active connection, or session, join, or publication
   * failures. Failure releases connection resources and restores local preview.
   */
  async connect(
    localStream: RealtimeMediaStream
  ): Promise<RealtimeMediaStream> {
    return this.lifecycleManager.run(
      RealtimeOperationKind.connection,
      undefined,
      async (token) => {
        const connectionState = this.lifecycleManager.currentState.connectionState;
        if (
          connectionState === RealtimeConnectionState.connecting ||
          connectionState === RealtimeConnectionState.connected ||
          connectionState === RealtimeConnectionState.starting ||
          connectionState === RealtimeConnectionState.generating
        ) {
          throw new XmaxError(
            XmaxErrorCode.invalidConfiguration,
            "A realtime connection is already active",
          );
        }
        return this.performConnect(
          localStream,
          token
        );
      },
    );
  }

  /**
   * Connects if needed and starts generation.
   *
   * Active generation updates conditions unless restart is true. The first task requires a context;
   * later calls may reuse cached conditions. Mount the returned remote stream in an SDK video view;
   * generating is entered only after the first frame and render warmup.
   *
   * @param options.localStream - This manager's local camera, external, image, or video-file stream.
   * @param options.context - The generation conditions; omission reuses cached conditions.
   * @param options.restart - Whether to retain RTC and start a new task without first sending stop;
   * defaults to false.
   * @param options.faceRestoration - Whether to restore the original face; defaults to false and updates
   * active tasks through change_condition.
   * @param options.extraParams - Additional start/change_condition parameters. Not cached or included in
   * automatic recovery; SDK fields cannot be overridden.
   * @returns A mountable remote stream without waiting for warmup; generating signals presentation
   * readiness.
   * @throws Rejects with invalidConfiguration for non-JSON, cyclic, or reserved extra parameters before
   * connection or condition updates.
   * @throws Rejects for foreign media, missing conditions, signaling failure, or unconfirmed generation,
   * stopping the task and releasing connection resources.
   */
  async startGeneration(
    options: {
      localStream: RealtimeMediaStream;
      context?: RealtimeContext;
      restart?: boolean;
      faceRestoration?: boolean;
      extraParams?: RealtimeExtraParams;
    }
  ): Promise<RealtimeMediaStream> {
    const extraParams = snapshotExtraParams(options.extraParams);
    return this.lifecycleManager.run(
      options.restart === true ? RealtimeOperationKind.generationRestart : RealtimeOperationKind.generation,
      undefined,
      async (token) => {
        const localTrack = options.localStream.videoTrack;
        if (!localTrack || localTrack !== this.currentLocalTrack) {
          throw new XmaxError(
            XmaxErrorCode.invalidConfiguration,
            "The local stream must be created and started by this realtime manager",
          );
        }
        const videoFormat = this.resolvedMediaVideoFormat ?? localTrack.videoFormat;
        if (!videoFormat) {
          throw new XmaxError(
            XmaxErrorCode.invalidConfiguration,
            "The local video format is unavailable",
          );
        }
        // Update conditions by default; an explicit restart retains RTC and creates a new task.
        const currentState = this.lifecycleManager.currentState;
        const hasGeneration = currentState.connectionState === RealtimeConnectionState.generating ||
          (currentState.connectionState === RealtimeConnectionState.starting && !!currentState.taskID);
        if (hasGeneration && options.restart !== true) {
          await this.generationManager.update(
            currentState.taskID,
            {
              videoFormat,
              ...this.resolveGenerationFormat(videoFormat),
              context: options.context,
              targetSize: this.downlinkQualityState?.size,
              faceRestoration: options.faceRestoration ?? false,
              extraParams,
            }
          );
          token.ensureCurrent();
          return this.connectionManager.makeRemoteStream();
        }
        const context = this.generationManager.validateContext(options.context);

        // Establish the connection before starting generation when necessary.
        if (currentState.connectionState !== RealtimeConnectionState.connected && !hasGeneration) {
          await this.performConnect(
            options.localStream,
            token
          );
        }

        return this.performStartGeneration(
          token,
          videoFormat,
          context,
          options.restart ?? false,
          options.faceRestoration ?? false,
          extraParams,
        );
      },
    );
  }

  /**
   * Observes original remote video and PCM audio before or during generation; undefined releases
   * observation resources. Call from a user gesture to unlock audio. Unsupported capabilities or setup
   * failure reject without affecting playback or generation.
   */
  async setRemoteMediaFrameListener(
    listener?: RealtimeMediaFrameListener
  ): Promise<void> {
    if (listener && !this.canReadRemoteAudio) {
      throw new XmaxError(
        XmaxErrorCode.mediaError,
        "This RTC platform cannot observe remote audio independently of playback"
      );
    }
    this.remoteMediaFrameObservation = false;
    this.remoteMediaFrames.setSource(undefined);
    this.updateRemoteMediaObservation();
    await this.remoteMediaFrames.setListener(listener);
    this.remoteMediaFrameObservation = Boolean(listener);
    this.updateRemoteMediaObservation();
  }

  /**
   * Delivers borrowed remote tracks without creating audio processors or video-frame readers.
   */
  setRemoteMediaTracksListener(
    listener?: (
      tracks?: RemoteMediaTracks
    ) => void
  ): void {
    this.remoteMediaTracksListener = listener;
    this.updateRemoteMediaObservation();
  }

  /**
   * Shares RTC track notifications between independent frame and track subscriptions.
   */
  private updateRemoteMediaObservation(): void {
    this.streamController.setRemoteMediaListener(
      this.remoteMediaFrameObservation || this.remoteMediaTracksListener ? tracks => {
        if (this.remoteMediaFrameObservation) {
          this.remoteMediaFrames.setSource(tracks);
        }
        try {
          this.remoteMediaTracksListener?.(tracks);
        } catch (error) {
          XmaxLogger.render.warning(() => `Remote media track observer failed: ${XmaxError.from(error).message}`);
        }
      } : undefined,
    );
  }

  /**
   * Disconnects while retaining local media preview.
   */
  async disconnect(): Promise<void> {
    this.mediaController.pauseLocalVideo();
    this.timing.cancel();
    this.clearVideoStatistics();
    await this.lifecycleManager.disconnect();
  }

  /**
   * Closes the lifecycle and releases connection, local media, and RTC resources. Concurrent calls await
   * the same cleanup. Local streams can be created again after closure.
   */
  async close(): Promise<void> {
    this.mediaController.pauseLocalVideo();
    this.timing.cancel();
    this.clearVideoStatistics();
    await this.lifecycleManager.terminate(RealtimeTerminationScope.all);
  }

  /**
   * Derives TRTC quality frame rates while retaining the initial dimensions.
   */
  private uplinkQualityFormat(
    baseline: RealtimeVideoFormat,
    level: number
  ): RealtimeVideoFormat {
    const format = qualityVideoFormat(
      baseline,
      level
    );
    return this.options.provider === RtcProvider.trtc
      ? format.resized(
        baseline.width,
        baseline.height
      )
      : format;
  }

  /**
   * Selects a generation canvas from the fixed media baseline and enables server padding for non-camera
   * aspect-ratio mismatches. Only signaling changes; uplink tracks and encoding dimensions remain
   * unchanged.
   *
   * @param videoFormat - The fixed media format, unaffected by uplink adaptation.
   * @returns The supported canvas format and padding preference.
   */
  private resolveGenerationFormat(
    videoFormat: RealtimeVideoFormat
  ): {
    generationVideoFormat: RealtimeVideoFormat;
    paddingContain: boolean;
  } {
    if (this.mediaController.source === "camera" && resolutionBuckets(this.options.model).length > 0) {
      return {
        generationVideoFormat: videoFormat,
        paddingContain: false
      };
    }

    const size = this.mediaService.resolveGenerationSize(videoFormat);
    const paddingContain = this.mediaController.source !== "camera" &&
      videoFormat.width * size.height !== videoFormat.height * size.width;
    return {
      generationVideoFormat: size.width !== videoFormat.width || size.height !== videoFormat.height
        ? videoFormat.resized(
          size.width,
          size.height
        ) : videoFormat,
      paddingContain,
    };
  }

  /**
   * Derives downlink dimensions from the fixed media baseline, preserving aspect ratio and four-pixel
   * alignment for all sources.
   *
   * @param videoFormat - The fixed media format.
   * @param level - The downlink quality level.
   * @returns Target dimensions within the level bounds without upscaling.
   */
  private resolveTargetSize(
    videoFormat: RealtimeVideoFormat,
    level: number
  ): ModelSize {
    return this.mediaService.resolveTargetSize(
      videoFormat,
      qualityVideoMaximumSize(
        videoFormat,
        level
      )
    );
  }

  /**
   * Selects initial uplink quality; disabled adaptation starts each connection at the original L1
   * baseline.
   */
  private resolveInitialUplinkQuality(
    track: RealtimeVideoTrack
  ): QualityState | undefined {
    const previous = this.qualityStates.get(track);
    if (previous && this.options.isAdaptiveQualityEnabled) {
      return undefined;
    }

    const baseline = previous?.baseline ?? track.videoFormat;
    if (!baseline) {
      return undefined;
    }

    let level = this.qualityHistory?.read("uplink") ?? 1;
    while (level > 1 && !supportsQualityEncoding(this.uplinkQualityFormat(
      baseline,
      level
    ))) {
      level--;
    }

    return {
      baseline,
      level
    };
  }

  /**
   * Creates the session, joins and publishes, starts heartbeats, and prepares remote rendering.
   *
   * @param localStream - The local stream owned by this manager.
   * @param token - The current operation lease.
   * @returns A placeholder stream for generated results.
   */
  private async performConnect(
    localStream: RealtimeMediaStream,
    token: RealtimeOperationToken,
  ): Promise<RealtimeMediaStream> {
    // Validate source ownership and configuration before changing connection state.
    const localTrack = localStream.videoTrack;
    if (!localTrack || localTrack !== this.currentLocalTrack) {
      throw new XmaxError(
        XmaxErrorCode.invalidConfiguration,
        "The local stream must be created and started by this realtime manager",
      );
    }
    this.connectionManager.validateConfiguration();

    token.setFailureScope(RealtimeTerminationScope.connection);
    await this.lifecycleManager.commit(
      new RealtimeState({ connectionState: RealtimeConnectionState.connecting }),
      token,
    );

    // Bind camera warmup to this connection so cancellation and exit stop the wait.
    const warmupController = new AbortController();
    const abortWarmup = () => warmupController.abort();
    token.signal.addEventListener(
      "abort",
      abortWarmup,
      { once: true }
    );
    if (token.signal.aborted) {
      abortWarmup();
    }

    try {
      let beforePublish: (() => Promise<void>) | undefined;
      if (this.mediaController.isFrameValidationEnabled) {
        // Warmup overlaps connection; observe early rejection while retaining the original publication barrier.
        const cameraReady = this.mediaController.waitForValidCameraFrame(warmupController.signal).then(() => {
          token.ensureCurrent();
        });

        void cameraReady.catch(() => { });
        beforePublish = () => cameraReady;
      }

      // New adaptive tracks read quality history, defaulting to L2; retain the L1 baseline
      // and prefer in-memory state on reconnection.
      const initialQuality = this.resolveInitialUplinkQuality(localTrack);
      const initialFormat = initialQuality && this.qualityController
        ? this.uplinkQualityFormat(
          initialQuality.baseline,
          initialQuality.level
        )
        : initialQuality?.baseline;
      const remote = await this.connectionManager.connect({
        localTrack,
        remoteVideoFormat: this.resolvedMediaVideoFormat ?? localTrack.videoFormat,
        localVideoFormat: initialFormat,
        onVideoEncoderConfigured: () => {
          if (!initialQuality || !initialFormat) {
            return;
          }
          this.resolvedMediaVideoFormat ??= initialQuality.baseline;
          localTrack.updateVideoFormat(initialFormat);
          this.qualityStates.set(
            localTrack,
            initialQuality
          );
          this.qualityHistory?.write(
            "uplink",
            initialQuality.level
          );
        },
        model: this.options.model,
        includeLocalAudio: this.mediaController.hasAudio,
        ensureCurrent: () => token.ensureCurrent(),
        onPublished: () => {
          this.acceptsVideoStatistics = true;
          this.mediaController.setExternalAudioPublished(true);
        },
        beforePublish,
      });

      await this.lifecycleManager.commit(
        new RealtimeState({
          connectionState: RealtimeConnectionState.connected,
          sessionID: this.connectionManager.currentSessionID,
        }),
        token,
      );

      return remote;
    } finally {
      token.signal.removeEventListener(
        "abort",
        abortWarmup
      );
      abortWarmup();
    }
  }

  /**
   * Coordinates first-frame timing and presentation state; the generation manager owns tasks and
   * confirmation.
   *
   * @param token - The current generation lease.
   * @param videoFormat - The fixed baseline for canvas, returned dimensions, and interaction
   * coordinates.
   * @param context - The resolved generation conditions.
   * @param restart - Whether to replace the task with a new start message.
   * @param faceRestoration - Whether to restore the original face.
   * @param extraParams - Additional uncached start parameters.
   * @returns The stream carrying generation results.
   */
  private async performStartGeneration(
    token: RealtimeOperationToken,
    videoFormat: NonNullable<RealtimeVideoTrack["videoFormat"]>,
    context: RealtimeContext,
    restart: boolean,
    faceRestoration: boolean,
    extraParams?: RealtimeExtraParams,
  ): Promise<RealtimeMediaStream> {
    token.setFailureScope(RealtimeTerminationScope.connection);
    const sessionID = this.connectionManager.currentSessionID;
    if (!sessionID) {
      throw new XmaxError(
        XmaxErrorCode.sessionError,
        "Realtime session is unavailable"
      );
    }

    await this.lifecycleManager.commit(
      new RealtimeState({
        connectionState: RealtimeConnectionState.starting,
        sessionID
      }),
      token,
    );
    token.ensureCurrent();

    const initialLevel = this.qualityHistory?.read("downlink") ?? 1;
    const targetSize = this.resolveTargetSize(
      videoFormat,
      initialLevel
    );

    const completeFirstFrame = this.timing.startFirstFrame();
    this.remoteRenderWarmupCompletedHandler = undefined;
    this.remoteFrameDisplayHandler = () => {
      if (!token.signal.aborted) {
        completeFirstFrame();
        this.remoteRenderWarmupCompletedHandler ??= this.timing.startRenderWarmup();
      }
    };
    this.renderController.prepareForGeneration();

    const taskID = await this.generationManager.start({
      videoFormat,
      ...this.resolveGenerationFormat(videoFormat),
      signal: token.signal,
      ensureCurrent: () => token.ensureCurrent(),
      waitUntilRemoteReady: () => this.connectionManager.waitUntilRemoteTrackReady(
        REMOTE_FIRST_FRAME_TIMEOUT_MS,
        token.signal,
      ),
      context,
      restart,
      targetSize,
      mirror: this.mediaController.source === "camera" &&
        this.currentLocalTrack?.position === CameraPosition.front,
      faceRestoration,
      onStartSent: this.mediaController.source === "localVideo" ? async () => {
        token.ensureCurrent();
        await this.mediaController.startLocalVideo(token.signal);
        token.ensureCurrent();
      } : undefined,
      extraParams,
    });

    token.ensureCurrent();

    this.downlinkQualityController?.stop();
    this.downlinkQualityState = {
      taskID,
      baseline: videoFormat,
      level: initialLevel,
      size: targetSize ?? {
        width: videoFormat.width,
        height: videoFormat.height
      },
    };
    await this.lifecycleManager.commit(
      new RealtimeState({
        connectionState: RealtimeConnectionState.starting,
        sessionID,
        taskID
      }),
      token,
    );
    token.ensureCurrent();
    // A mounted view may finish warmup early; commit generating only after task confirmation.
    await this.completeGenerationPresentation();
    token.ensureCurrent();
    this.qualityHistory?.write(
      "downlink",
      initialLevel
    );

    return this.connectionManager.makeRemoteStream();
  }

  /**
   * Commits presentation readiness after task startup and view warmup, without blocking the remote
   * stream's return.
   */
  private async completeGenerationPresentation(): Promise<void> {
    const { sessionID, taskID } = this.currentState;
    if (!sessionID || !taskID) {
      return;
    }

    await this.lifecycleManager.remotePreviewDidBecomeReady(
      sessionID,
      taskID,
      () => this.renderController.isReady,
    );
  }

  /**
   * Terminates the connection on heartbeat or session failure and exposes the reason in the final state.
   */
  private async handleHeartbeatFailure(
    sessionID: string,
    error: XmaxError,
  ): Promise<void> {
    await this.lifecycleManager.terminateWithError(
      error,
      RealtimeTerminationScope.connection,
      () => this.connectionManager.currentSessionID === sessionID,
    );
  }

  /**
   * Stops heartbeat and generation before disconnecting; the all scope also releases local media.
   */
  private async performCleanup(
    scope: RealtimeTerminationScope,
    taskID: string,
  ): Promise<RealtimeCleanupResult> {
    this.remoteMediaFrames.setSource(undefined);
    this.mediaController.setExternalAudioPublished(false);
    this.mediaController.pauseLocalVideo();
    this.timing.cancel();
    this.remoteFrameDisplayHandler = undefined;
    this.remoteRenderWarmupCompletedHandler = undefined;
    this.clearVideoStatistics();

    this.connectionManager.clearRemoteMedia();

    this.connectionManager.stopHeartbeat();
    await this.generationManager.reset(taskID);
    const sessionID = await this.connectionManager.disconnect();

    if (scope === RealtimeTerminationScope.all) {
      this.setRemoteMediaTracksListener(undefined);
      await this.setRemoteMediaFrameListener(undefined);
      this.resolvedMediaVideoFormat = undefined;
      this.disposePermissionWatch();
      try {
        await this.mediaController.stopLocalStream();
      } catch (error) {
        XmaxLogger.realtime.error(
          () =>
            `释放本地媒体失败 (Failed to Release Local Media)\n` +
            `└─ ${XmaxLogger.localized("原因：", "Reason: ")}${XmaxError.from(error).message}`,
        );
      }
    }

    return {
      sessionID,
      hasLocalMedia: this.currentLocalTrack !== undefined,
    };
  }

  /**
   * Validates a volume from 0 to 1.
   */
  private static validateVolume(
    volume: number
  ): void {
    if (!Number.isFinite(volume) || volume < 0 || volume > 1) {
      throw new XmaxError(
        XmaxErrorCode.invalidConfiguration,
        "Audio volume must be between 0 and 1",
      );
    }
  }
}
