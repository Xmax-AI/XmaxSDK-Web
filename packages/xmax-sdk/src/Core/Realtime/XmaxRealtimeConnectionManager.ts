//
//  XmaxRealtimeConnectionManager.ts
//  XmaxSDK
//
//  Author: 翁跃庭 (Yueting Weng)
//  GitHub: https://github.com/Xmax-AI/XmaxSDK-Web
//
//  Copyright (c) 2026 XMAX.AI PTE. LTD.
//

import { XmaxError, XmaxErrorCode } from "../../Foundation/Errors/XmaxError";
import { XmaxLogger } from "../../Foundation/Logging/XmaxLogger";
import type { RenderControlling } from "../../Render/RenderControlling";
import type { InteractionFrame } from "../../Media/Interaction/InteractionFrame";
import { RealtimeMediaStream } from "../../Service/Realtime/RealtimeMediaStream";
import type { RealtimeModelName } from "../../Service/Realtime/RealtimeModel";
import { connectionAppID } from "../../Service/Realtime/RealtimeSessionConnection";
import { RealtimeSession } from "../../Service/Realtime/RealtimeSession";
import type { RealtimeSessionServicing } from "../../Service/Realtime/RealtimeSessionServicing";
import { RealtimeVideoTrack } from "../../Service/Realtime/RealtimeVideoTrack";
import { StreamID } from "../../Service/Realtime/StreamID";
import type { RemoteStreamBinding, StreamControlling } from "../../Stream/StreamControlling";
import type { RealtimeTiming } from "./RealtimeTiming";
import { RealtimeCoordinator } from "./RealtimeCoordinator";
import { RtcProvider } from "../../Foundation/RTC/RtcProvider";

/**
 * Owns sessions, heartbeats, RTC connections, and remote tracks without committing public state.
 */
export class XmaxRealtimeConnectionManager {

  /**
   * The session currently owned by this connection.
   */
  private activeSession?: RealtimeSession;

  /**
   * The credential-refresh revision used to reject obsolete lifecycle updates.
   */
  private refreshVersion = 0;

  /**
   * The shared in-progress credential refresh.
   */
  private credentialRefresh?: Promise<void>;

  /**
   * The serialized credential-application chain.
   */
  private credentialApplication: Promise<void> = Promise.resolve();

  /**
   * The controller cancelling current credential refresh and recovery.
   */
  private credentialController?: AbortController;

  /**
   * The active remote track registered with the render layer.
   */
  private activeRemoteTrack?: RealtimeVideoTrack;

  /**
   * Creates a connection manager.
   *
   * @param dependencies - The session, transport, timing, and rendering dependencies.
   */
  constructor(
    private readonly dependencies: {
      provider?: RtcProvider;
      sessionService?: RealtimeSessionServicing;
      streamController: StreamControlling;
      timing: RealtimeTiming;
      remoteAudioVolume: () => number;
      onHeartbeatFailure: (
        sessionID: string,
        error: XmaxError
      ) => void;
      renderController: RenderControlling;
      onInteraction: (
        frame: InteractionFrame
      ) => void;
    }
  ) { }

  /**
   * The active session ID; undefined before connection or after cleanup.
   */
  get currentSessionID(): string | undefined {
    return this.activeSession?.id;
  }

  /**
   * Requires session services before connection without preventing local preview.
   */
  validateConfiguration(): void {
    this.requireSessionService();
  }

  /**
   * Creates a session, configures encoding, joins, publishes, and starts heartbeats before returning a
   * remote placeholder. Session creation, room join, and publication are timed separately. Optional
   * pre-publication checks block publication and contribute only to overall startup time.
   *
   * @param options.localTrack - The active local media track.
   * @param options.remoteVideoFormat - The original generation and remote format; defaults to the local
   * track's format.
   * @param options.localVideoFormat - The actual uplink format, independent of generation and remote
   * dimensions.
   * @param options.onVideoEncoderConfigured - The callback after uplink configuration succeeds.
   * @param options.model - The model used to create the session.
   * @param options.includeLocalAudio - Whether to publish local audio.
   * @param options.ensureCurrent - The operation-validity check.
   * @param options.onPublished - The callback after publication succeeds.
   * @param options.beforePublish - An optional asynchronous publication prerequisite.
   * @throws Rejects for session, join, publication, or lease failures; the caller performs lifecycle
   * cleanup.
   */
  async connect(
    options: {
      localTrack: RealtimeVideoTrack;
      remoteVideoFormat?: RealtimeVideoTrack["videoFormat"];
      localVideoFormat?: RealtimeVideoTrack["videoFormat"];
      onVideoEncoderConfigured?: () => void;
      model: RealtimeModelName;
      includeLocalAudio: boolean;
      ensureCurrent: () => void;
      onPublished: () => void;
      beforePublish?: () => Promise<void>;
    }
  ): Promise<RealtimeMediaStream> {
    const sessionService = this.requireSessionService();
    const streamController = this.dependencies.streamController;

    // Register the session immediately so failure cleanup can close it.
    options.ensureCurrent();
    const completeSession = this.dependencies.timing.startSession();
    const session = await sessionService.createSession(options.model);
    this.activeSession = session;
    options.ensureCurrent();
    completeSession();

    const connection = session.connection;
    if (!connection) {
      throw new XmaxError(
        XmaxErrorCode.sessionError,
        "Session does not contain RTC join information",
      );
    }
    // Services and adapters must share the configured provider; it is not selected by the backend response.
    if (connection.provider !== (this.dependencies.provider ?? RtcProvider.trtc)) {
      throw new XmaxError(
        XmaxErrorCode.sessionError,
        "RTC adapter configuration does not match the session service"
      );
    }
    const refreshVersion = ++this.refreshVersion;
    this.credentialController = new AbortController();

    // Configure encoding before publication; capture itself does not publish media.
    const videoFormat = options.localVideoFormat ?? options.localTrack.videoFormat;
    if (!videoFormat) {
      throw new XmaxError(
        XmaxErrorCode.internalError,
        "Local video stream has no video format",
      );
    }
    await streamController.updateUplinkVideoFormat(videoFormat);
    options.ensureCurrent();
    options.onVideoEncoderConfigured?.();
    options.ensureCurrent();

    let completePublish: (() => void) | undefined;
    await streamController.connect(
      connection,
      options.includeLocalAudio,
      () => {
        options.ensureCurrent();
      },
      async () => {
        options.ensureCurrent();

        // Warmup overlaps connection; its remaining wait is excluded from join and publication durations.
        await options.beforePublish?.();
        options.ensureCurrent();
        completePublish = this.dependencies.timing.startPublish();
      },
      () => this.dependencies.timing.startRtcJoin()
    );
    options.ensureCurrent();
    completePublish?.();
    options.onPublished();

    sessionService.startHeartbeat(
      session.id,
      {
        onFailure: (
          sessionID,
          error
        ) => {
          this.dependencies.onHeartbeatFailure(
            sessionID,
            error
          );
        },
        onRefresh: (refreshed) => {
          return this.handleSessionRefresh(
            refreshed,
            refreshVersion
          );
        },
      }
    );

    const remoteTrack = new RealtimeVideoTrack({
      id: connection.botID ?? "video-remote",
      videoFormat: options.remoteVideoFormat ?? options.localTrack.videoFormat,
    });
    this.activeRemoteTrack = remoteTrack;
    this.dependencies.renderController.registerRemoteTrack(
      remoteTrack,
      this.dependencies.onInteraction
    );
    streamController.setRemoteAudioVolume(this.dependencies.remoteAudioVolume());

    return new RealtimeMediaStream({
      id: StreamID.remote,
      videoTrack: remoteTrack
    });
  }

  /**
   * Clears rendered remote media while retaining track/view bindings for unified cleanup.
   */
  clearRemoteMedia(): void {
    this.dependencies.renderController.setRemoteMedia(null);
  }

  /**
   * Stops session heartbeats if a session service exists.
   */
  stopHeartbeat(): void {
    this.refreshVersion++;
    this.credentialController?.abort();
    this.credentialController = undefined;
    this.credentialRefresh = undefined;
    this.credentialApplication = Promise.resolve();
    this.dependencies.sessionService?.stopHeartbeat();
  }

  /**
   * Refreshes expired RTC credentials through a session heartbeat, merging concurrent requests.
   */
  async refreshCredentials(): Promise<void> {
    if (this.credentialRefresh) {
      return this.credentialRefresh;
    }
    const current = this.activeSession;
    if (!current?.connection || current.connection.provider === RtcProvider.trtc) {
      return;
    }
    const version = this.refreshVersion;
    const operation = (async () => {
      try {
        const session = await this.requireSessionService().heartbeatSession(current.id);
        await this.handleSessionRefresh(
          session,
          version,
          true
        );
      } catch (error) {
        if (version === this.refreshVersion && this.activeSession?.id === current.id) {
          this.dependencies.onHeartbeatFailure(
            current.id,
            XmaxError.from(error)
          );
        }
      }
    })();
    this.credentialRefresh = operation;
    try {
      await operation;
    }
    finally {
      if (this.credentialRefresh === operation) {
        this.credentialRefresh = undefined;
      }
    }
  }

  /**
   * Waits for the received track to unmute. Timeout only warns; cancellation exits immediately and
   * releases listeners.
   */
  async waitUntilRemoteTrackReady(
    timeoutMs: number,
    signal: AbortSignal
  ): Promise<void> {
    if (signal.aborted) {
      throw RealtimeCoordinator.cancelledError();
    }

    const mediaTrack = this.activeRemoteTrack?.mediaStreamTrack;
    if (!mediaTrack || !mediaTrack.muted) {
      return;
    }

    await new Promise<void>((
      resolve,
      reject
    ) => {
      const cleanup = () => {
        clearTimeout(timer);
        mediaTrack.removeEventListener(
          "unmute",
          finish
        );
        signal.removeEventListener(
          "abort",
          abort
        );
      };
      const finish = () => {
        cleanup();
        resolve();
      };
      const abort = () => {
        cleanup();
        reject(RealtimeCoordinator.cancelledError());
      };

      const timer = setTimeout(
        () => {
          XmaxLogger.realtime.warning(() => "等待远端生成流首帧超时 (Timed Out Waiting for the First Remote Frame)");
          finish();
        },
        timeoutMs
      );

      mediaTrack.addEventListener(
        "unmute",
        finish
      );
      signal.addEventListener(
        "abort",
        abort,
        { once: true }
      );
      if (signal.aborted) {
        abort();
      }
    });
  }

  /**
   * Updates the remote track and views when transport binds or clears a generated stream.
   *
   * @param binding - The remote stream and video track, or null to clear them.
   * @throws An error if a stream arrives without an active connection, preventing generation
   * confirmation.
   */
  handleRemoteStreamBinding(
    binding: RemoteStreamBinding | null
  ): void {
    const track = this.activeRemoteTrack;
    if (!binding) {
      if (track) {
        track.mediaStreamTrack = undefined;
      }
      this.dependencies.renderController.setRemoteMedia(null);
      return;
    }

    if (!track) {
      throw new XmaxError(
        XmaxErrorCode.rtcError,
        "Remote generation stream arrived without an active realtime connection",
      );
    }

    track.mediaStreamTrack = binding.videoTrack;
    this.dependencies.renderController.setRemoteMedia(binding.videoTrack);
  }

  /**
   * Creates a media stream for the current remote result track.
   */
  makeRemoteStream(): RealtimeMediaStream {
    const track = this.activeRemoteTrack;
    if (!track) {
      throw new XmaxError(
        XmaxErrorCode.rtcError,
        "The remote generation stream is unavailable",
      );
    }
    return new RealtimeMediaStream({
      id: StreamID.remote,
      videoTrack: track
    });
  }

  /**
   * Applies changed heartbeat credentials to the active connection. Changes to provider, room,
   * application, or login identity invalidate the connection instead.
   */
  private handleSessionRefresh(
    session: RealtimeSession,
    version: number,
    force = false
  ): Promise<void> {
    // Serialize heartbeat and token-expiry responses so late work cannot replace newer credentials.
    const operation = this.credentialApplication.then(() => this.applySessionRefresh(
      session,
      version,
      force
    ));
    this.credentialApplication = operation.catch(() => { });
    return operation;
  }

  /**
   * Validates the room binding and applies credentials without restoring obsolete connection state.
   */
  private async applySessionRefresh(
    session: RealtimeSession,
    version: number,
    force: boolean
  ): Promise<void> {
    const current = this.activeSession;
    if (version !== this.refreshVersion || !current || current.id !== session.id) {
      return;
    }

    const next = session.connection;
    if (!next) {
      return;
    }

    const previous = current.connection;
    const bindingChanged =
      previous !== undefined &&
      (next.provider !== previous.provider ||
        next.roomID !== previous.roomID ||
        connectionAppID(next) !== connectionAppID(previous) ||
        next.botID !== previous.botID ||
        next.userID !== previous.userID);
    if (bindingChanged) {
      this.dependencies.onHeartbeatFailure(
        session.id,
        new XmaxError(
          XmaxErrorCode.sessionError,
          "RTC session binding changed during heartbeat"
        ),
      );
      return;
    }

    if (
      next.provider !== RtcProvider.trtc &&
      (force || !previous || previous.provider === RtcProvider.trtc || next.roomToken !== previous.roomToken)
    ) {
      await this.dependencies.streamController.updateCredentials(
        next,
        this.credentialController?.signal
      );
      if (version !== this.refreshVersion || this.activeSession !== current) {
        return;
      }
    }

    this.activeSession = new RealtimeSession({
      id: session.id,
      userID: session.userID ?? current.userID,
      status: session.status ?? current.status,
      connection: next,
      closeReason: session.closeReason,
    });
  }

  /**
   * Attempts all connection cleanup, closing the server session even if leaving the room fails.
   */
  async disconnect(): Promise<string | undefined> {
    const sessionID = this.activeSession?.id;

    this.stopHeartbeat();
    this.clearRemoteMedia();

    try {
      await this.dependencies.streamController.disconnect();
    } catch (error) {
      XmaxLogger.realtime.error(() => `断开 RTC 连接失败 (Failed to Disconnect RTC)\n└─ ${XmaxError.from(error).message}`);
    }

    const track = this.activeRemoteTrack;
    if (track) {
      this.dependencies.renderController.resetRemoteTrack();
      track.mediaStreamTrack = undefined;
    }

    this.activeSession = undefined;
    this.activeRemoteTrack = undefined;

    if (sessionID && this.dependencies.sessionService) {
      try {
        await this.dependencies.sessionService.closeSession(sessionID);
      } catch (error) {
        XmaxLogger.realtime.error(() => `关闭实时会话失败 (Failed to Close Realtime Session)\n└─ ${XmaxError.from(error).message}`);
      }
    }

    return sessionID;
  }

  /**
   * Returns the session service or throws a configuration error.
   */
  private requireSessionService(): RealtimeSessionServicing {
    if (!this.dependencies.sessionService) {
      throw new XmaxError(
        XmaxErrorCode.invalidConfiguration,
        "The realtime manager is not configured with an API service",
      );
    }
    return this.dependencies.sessionService;
  }
}
