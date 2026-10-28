//
//  XmaxRealtimeFactory.ts
//  XmaxSDK
//
//  Author: 翁跃庭 (Yueting Weng)
//  GitHub: https://github.com/Xmax-AI/XmaxSDK-Web
//
//  Copyright (c) 2026 XMAX.AI PTE. LTD.
//

import type { XmaxError } from "../../Foundation/Errors/XmaxError";
import { createRtcManager } from "../../Foundation/RTC/RtcFactory";
import type { RtcManaging } from "../../Foundation/RTC/RtcManaging";
import { RtcProvider } from "../../Foundation/RTC/RtcProvider";
import { MediaController } from "../../Media/MediaController";
import type { MediaControlling } from "../../Media/MediaControlling";
import type { CameraControlling } from "../../Media/Camera/CameraControlling";
import { RenderController } from "../../Render/RenderController";
import type { RenderControlling } from "../../Render/RenderControlling";
import { MediaService } from "../../Service/Media/MediaService";
import type { ApiServicing } from "../../Service/Network/ApiServicing";
import { RealtimeSessionService } from "../../Service/Realtime/RealtimeSessionService";
import type { RealtimeSessionServicing } from "../../Service/Realtime/RealtimeSessionServicing";
import type { RealtimeNetworkQualityListener } from "../../Service/Realtime/RealtimeNetworkQuality";
import type { UplinkVideoStatisticsListener, DownlinkVideoStatisticsListener } from "../../Foundation/RTC/VideoStatistics";
import { StreamController } from "../../Stream/StreamController";
import type { StreamControlling } from "../../Stream/StreamControlling";
import { QualityController } from "../../Stream/Quality/QualityController";
import { QualityHistory } from "../../Stream/Quality/QualityHistory";
import { XmaxEnvironment } from "../XmaxEnvironment";
import type { RealtimeConfiguration } from "./RealtimeConfiguration";
import { RealtimeTiming } from "../../Service/Realtime/RealtimeTiming";
import { XmaxRealtimeConnectionManager } from "./XmaxRealtimeConnectionManager";
import { XmaxRealtimeGenerationManager } from "./XmaxRealtimeGenerationManager";
import { XmaxRealtimeErrorManager } from "./XmaxRealtimeErrorManager";
import {
  XmaxRealtimeLifecycleManager,
  RealtimeOperationKind,
  RealtimeTerminationScope,
  type RealtimeCleanupHandler,
  type RealtimeOperationToken,
} from "./XmaxRealtimeLifecycleManager";

/**
 * Optional replacements for realtime services and controllers sharing one RTC engine.
 */
export interface XmaxRealtimeDependencies {

  /**
   * The service environment; defaults to China when omitted.
   */
  environment?: XmaxEnvironment;

  /**
   * The API service used to create the default session service.
   */
  apiService?: ApiServicing;

  /**
   * The session service, taking precedence over the API service.
   */
  sessionService?: RealtimeSessionServicing;

  /**
   * The transport controller replacing default publication and signaling.
   */
  streamController?: StreamControlling;

  /**
   * The camera controller replacing default capture and preview.
   */
  cameraController?: CameraControlling;

  /**
   * The RTC engine shared by default media and transport components.
   */
  rtcManager?: RtcManaging;
}

/**
 * Business callbacks supplied by the realtime manager during component assembly.
 */
export interface XmaxRealtimeBindings {

  /**
   * Clears statistics before accepting a replacement remote stream.
   */
  clearRemoteVideoStatistics(): void;

  /**
   * Reports that the remote view submitted its first frame.
   */
  onFrameDisplayed(): void;

  /**
   * Completes timing for the remote view's warmup.
   */
  onRenderWarmupCompleted(): void;

  /**
   * Commits generation presentation after the view completes warmup.
   */
  completeGenerationPresentation(): Promise<void>;

  /**
   * Reads the current remote playback volume, from 0 to 1.
   */
  remoteAudioVolume(): number;

  /**
   * Handles a heartbeat failure for the identified session.
   */
  onHeartbeatFailure(
    sessionID: string,
    error: XmaxError
  ): Promise<void>;

  /**
   * Releases the resources selected by lifecycle termination.
   */
  cleanup: RealtimeCleanupHandler;

  /**
   * Applies an uplink quality change inside the admitted configuration operation.
   */
  applyUplinkQuality(
    level: number,
    token: RealtimeOperationToken,
    signal: AbortSignal
  ): Promise<void>;

  /**
   * Applies a downlink quality change inside the admitted configuration operation.
   */
  applyDownlinkQuality(
    level: number,
    token: RealtimeOperationToken,
    signal: AbortSignal
  ): Promise<void>;

  /**
   * Checks whether the current track supports a candidate uplink level.
   */
  supportsUplinkQuality(
    level: number
  ): boolean;
}

/**
 * Statistics receivers installed after the manager owns its assembled components.
 */
export interface XmaxRealtimeStatisticsListeners {

  /**
   * Receives uplink video statistics and reset notifications.
   */
  uplink: UplinkVideoStatisticsListener;

  /**
   * Receives connection network-quality samples and reset notifications.
   */
  network: RealtimeNetworkQualityListener;

  /**
   * Receives downlink video statistics and reset notifications.
   */
  downlink: DownlinkVideoStatisticsListener;
}

/**
 * Realtime components and capabilities assembled for one manager.
 */
export interface XmaxRealtimeComponents {

  /**
   * The service resolving media dimensions and model constraints.
   */
  readonly mediaService: MediaService;

  /**
   * The shared runtime error logger.
   */
  readonly errorManager: XmaxRealtimeErrorManager;

  /**
   * Whether original remote audio can be observed independently of playback volume.
   */
  readonly canReadRemoteAudio: boolean;

  /**
   * The transport controller for publication, subscription, and signaling.
   */
  readonly streamController: StreamControlling;

  /**
   * The local media and interaction controller.
   */
  readonly mediaController: MediaControlling;

  /**
   * The remote rendering controller.
   */
  readonly renderController: RenderControlling;

  /**
   * The session and RTC connection owner.
   */
  readonly connectionManager: XmaxRealtimeConnectionManager;

  /**
   * The generation task and signaling owner.
   */
  readonly generationManager: XmaxRealtimeGenerationManager;

  /**
   * The operation-admission, state, and cleanup owner.
   */
  readonly lifecycleManager: XmaxRealtimeLifecycleManager;

  /**
   * The persisted history of successfully applied quality levels.
   */
  readonly qualityHistory?: QualityHistory;

  /**
   * The optional uplink adaptation state machine.
   */
  readonly qualityController?: QualityController;

  /**
   * The optional downlink adaptation state machine.
   */
  readonly downlinkQualityController?: QualityController;
}

/**
 * Creates realtime components and binds their existing failure, media, and quality callbacks.
 */
export class XmaxRealtimeFactory {

  /**
   * Creates components in dependency order without starting capture, joining, or generation.
   */
  static make(
    options: RealtimeConfiguration,
    dependencies: XmaxRealtimeDependencies | undefined,
    timing: RealtimeTiming,
    bindings: XmaxRealtimeBindings
  ): XmaxRealtimeComponents {
    const mediaService = new MediaService(options.model);

    const errorManager = new XmaxRealtimeErrorManager();

    const rtcManager = dependencies?.rtcManager ?? createRtcManager(
      options.provider,
      dependencies?.environment ?? XmaxEnvironment.china
    );
    const canReadRemoteAudio = options.provider !== RtcProvider.trtc || rtcManager.supportsRemoteAudioVolumeControl;

    const sessionService =
      dependencies?.sessionService ??
      (dependencies?.apiService
        ? new RealtimeSessionService({
          apiService: dependencies.apiService,
          provider: options.provider
        })
        : undefined);
    let connectionManager: XmaxRealtimeConnectionManager;
    let lifecycleManager: XmaxRealtimeLifecycleManager;

    const streamController = dependencies?.streamController ?? new StreamController({
      rtcManager,
      onCredentialsRequired: () => {
        void connectionManager.refreshCredentials();
      },
      errorListener: (error) => {
        void errorManager.report(error);
      },
      remoteStreamListener: (binding) => {
        bindings.clearRemoteVideoStatistics();
        connectionManager.handleRemoteStreamBinding(binding);
      },
    });

    const mediaController = new MediaController({
      rtcManager,
      mediaService,
      cameraController: dependencies?.cameraController,
      onCameraError: error => {
        void errorManager.report(error);
      },
      onVideoError: error => {
        void lifecycleManager.terminateWithError(
          error,
          RealtimeTerminationScope.connection
        );
      },
      onExternalError: error => {
        void lifecycleManager.terminateWithError(
          error,
          RealtimeTerminationScope.all
        );
      },
      onImageError: error => {
        void lifecycleManager.terminateWithError(
          error,
          RealtimeTerminationScope.all
        );
      },
      interactionListener: (
        taskID,
        points
      ) => streamController.sendTracks(
        taskID,
        points
      ),
    });
    const renderController = new RenderController({
      onFrameDisplayed: () => bindings.onFrameDisplayed(),
      onRenderWarmupCompleted: () => {
        bindings.onRenderWarmupCompleted();
        void bindings.completeGenerationPresentation().catch(error => errorManager.report(error));
      },
    });
    connectionManager = new XmaxRealtimeConnectionManager({
      provider: options.provider,
      sessionService,
      streamController,
      timing,
      remoteAudioVolume: () => bindings.remoteAudioVolume(),
      onHeartbeatFailure: (
        sessionID,
        error
      ) => {
        void bindings.onHeartbeatFailure(
          sessionID,
          error
        );
      },
      renderController,
      onInteraction: frame => mediaController.submitInteraction(frame),
    });
    const generationManager = new XmaxRealtimeGenerationManager(
      streamController,
      mediaController,
      renderController
    );

    lifecycleManager = new XmaxRealtimeLifecycleManager({
      errorManager,
      cleanup: (
        scope,
        taskID
      ) => bindings.cleanup(
        scope,
        taskID
      ),
    });

    let qualityHistory: QualityHistory | undefined;
    let qualityController: QualityController | undefined;
    let downlinkQualityController: QualityController | undefined;

    if (options.isAdaptiveQualityEnabled &&
      (options.provider === RtcProvider.agora || options.provider === RtcProvider.trtc)) {
      qualityHistory = new QualityHistory(
        options.model,
        options.provider
      );
      qualityController = new QualityController(
        async (
          change,
          signal
        ) => {
          await lifecycleManager.run(
            RealtimeOperationKind.configuration,
            undefined,
            async token => {
              await bindings.applyUplinkQuality(
                change.to,
                token,
                signal
              );
            }
          );
        },
        undefined,
        {},
        level => bindings.supportsUplinkQuality(level)
      );
      downlinkQualityController = new QualityController(async (
        change,
        signal
      ) => {
        await lifecycleManager.run(
          RealtimeOperationKind.configuration,
          undefined,
          async token => {
            await bindings.applyDownlinkQuality(
              change.to,
              token,
              signal
            );
          }
        );
      });
    }

    return {
      mediaService,
      errorManager,
      canReadRemoteAudio,
      streamController,
      mediaController,
      renderController,
      connectionManager,
      generationManager,
      lifecycleManager,
      qualityHistory,
      qualityController,
      downlinkQualityController,
    };
  }

  /**
   * Installs statistics listeners after the manager has assigned all component references.
   */
  static bindStatistics(
    streamController: StreamControlling,
    listeners: XmaxRealtimeStatisticsListeners
  ): void {
    streamController.setUplinkVideoStatisticsListener(listeners.uplink);
    streamController.setNetworkQualityListener(listeners.network);
    streamController.setDownlinkVideoStatisticsListener(listeners.downlink);
  }
}

