//
//  StreamController.ts
//  XmaxSDK
//
//  Author: 翁跃庭 (Yueting Weng)
//  GitHub: https://github.com/Xmax-AI/XmaxSDK-Web
//
//  Copyright (c) 2026 XMAX.AI PTE. LTD.
//

import { XmaxError, XmaxErrorCode, type XmaxErrorListener } from "../Foundation/Errors/XmaxError";
import { XmaxLogger } from "../Foundation/Logging/XmaxLogger";
import { RemoteStream } from "../Foundation/RTC/RemoteStream";
import { toRoomJoinConfiguration } from "../Service/Realtime/RealtimeSessionConnection";
import type { RtcManaging } from "../Foundation/RTC/RtcManaging";
import type { DownlinkVideoStatisticsListener, UplinkVideoStatisticsListener } from "../Foundation/RTC/VideoStatistics";
import type { RealtimeNetworkQualityListener } from "../Foundation/RTC/NetworkStatistics";
import type { RealtimePoint } from "../Service/Realtime/RealtimePoint";
import type { RtcSessionConnection } from "../Service/Realtime/RealtimeSessionConnection";
import type { RealtimeVideoFormat } from "../Service/Realtime/RealtimeVideoFormat";
import type { RoomListener, RoomControlling } from "./Room/RoomControlling";
import { RoomController } from "./Room/RoomController";
import type { ModelSize } from "../Service/Realtime/RealtimeModel";
import type { EncodingControlling } from "./Encoding/EncodingControlling";
import { EncodingController } from "./Encoding/EncodingController";
import type { RemoteMediaTracks } from "../Foundation/Media/RemoteMediaTracks";
import type {
  RemoteStreamListener,
  StreamControlling,
  StreamGenerationOptions,
} from "./StreamControlling";

/**
 * A pending generation-start confirmation.
 */
interface GenerationWaiter {

  /**
   * The generation task identifier.
   */
  taskID: string;

  /**
   * Completes the confirmation successfully.
   */
  resolve: () => void;

  /**
   * Completes the confirmation with an error.
   */
  reject: (
    error: XmaxError
  ) => void;

  /**
   * The timer that limits the confirmation wait.
   */
  timeoutTimer: ReturnType<typeof setTimeout>;

  /**
   * Whether generation confirmation is still pending.
   */
  confirmationPending: boolean;
}

/**
 * The current transport state.
 */
interface StreamState {

  /**
   * The RTC room identifier.
   */
  roomID: string;

  /**
   * The room user identifier expected to publish generated video.
   */
  botID: string;

  /**
   * Whether local video has been published.
   */
  localVideoPublished: boolean;

  /**
   * Whether local audio has been published.
   */
  localAudioPublished: boolean;

  /**
   * Remote users whose main video has been subscribed.
   */
  subscribedRemoteUserIDs: Set<string>;

  /**
   * Remote users currently publishing main video.
   */
  publishedRemoteUserIDs: Set<string>;

  /**
   * Subscribed video tracks indexed by remote user.
   */
  remoteVideoTracks: Map<string, MediaStreamTrack>;

  /**
   * Pending video subscription identities indexed by remote user.
   */
  remoteVideoSubscriptions: Map<string, object>;

  /**
   * Remote users whose audio has been subscribed.
   */
  subscribedRemoteAudioUserIDs: Set<string>;

  /**
   * The current generation task identifier.
   */
  generationTaskID?: string;

  /**
   * The pending confirmation for the current task.
   */
  generationWaiter?: GenerationWaiter;

  /**
   * The remote stream carrying the current generated result.
   */
  activeRemoteStream?: RemoteStream;

}

/**
 * Creates an empty transport state with fresh subscription collections.
 */
function makeInitialState(): StreamState {
  return {
    roomID: "",
    botID: "",
    localVideoPublished: false,
    localAudioPublished: false,
    subscribedRemoteUserIDs: new Set(),
    publishedRemoteUserIDs: new Set(),
    remoteVideoTracks: new Map(),
    remoteVideoSubscriptions: new Map(),
    subscribedRemoteAudioUserIDs: new Set(),
  };
}

/**
 * Dependencies and callbacks for media transport, room signaling, and generation confirmation.
 */
export interface StreamControllerOptions {

  /**
   * Requests refreshed session credentials when RTC credentials expire or approach expiration.
   */
  onCredentialsRequired?: () => void;

  /**
   * The RTC engine used for media transport.
   */
  rtcManager: RtcManaging;

  /**
   * An optional room lifecycle and signaling controller.
   */
  roomController?: RoomControlling;

  /**
   * An optional video encoding controller.
   */
  encodingController?: EncodingControlling;

  /**
   * The runtime error listener.
   */
  errorListener?: XmaxErrorListener;

  /**
   * The listener for remote result-stream binding and cleanup.
   */
  remoteStreamListener?: RemoteStreamListener;

  /**
   * The generation confirmation timeout, in milliseconds; defaults to 30000.
   */
  generationTimeoutMs?: number;
}

/**
 * Coordinates room membership, media publication and subscription, and generation confirmation.
 *
 * Generation is confirmed when the result publisher's video is subscribed and its render binding is
 * accepted; confirmation does not use SEI.
 */
export class StreamController implements StreamControlling {

  /**
   * The RTC engine used for media transport.
   */
  private readonly rtcManager: RtcManaging;

  /**
   * The controller for room membership and signaling.
   */
  private readonly roomController: RoomControlling;

  /**
   * The controller that applies uplink encoding parameters.
   */
  private readonly encodingController: EncodingControlling;

  /**
   * The runtime error listener.
   */
  private readonly errorListener: XmaxErrorListener;

  /**
   * The listener for remote result-stream changes.
   */
  private readonly remoteStreamListener: RemoteStreamListener;

  /**
   * The observer of original result tracks; extra audio tracks are retrieved only when it is set.
   */
  private remoteMediaListener?: (
    tracks?: RemoteMediaTracks
  ) => void;

  /**
   * The listener for uplink video statistics.
   */
  private localVideoStatisticsListener?: UplinkVideoStatisticsListener;

  /**
   * The listener for network quality statistics.
   */
  private networkStatisticsListener?: RealtimeNetworkQualityListener;

  /**
   * The listener for downlink video statistics.
   */
  private remoteVideoStatisticsListener?: DownlinkVideoStatisticsListener;

  /**
   * The generation confirmation timeout, in milliseconds.
   */
  private readonly generationTimeoutMs: number;

  /**
   * The remote audio playback volume, from 0 to 100.
   */
  private remoteAudioVolumePercentage = 100;

  /**
   * The current room, subscription, and generation state.
   */
  private state: StreamState = makeInitialState();

  /**
   * The current receiver for room messages.
   */
  private roomListener?: RoomListener;

  /**
   * Creates a media transport controller.
   */
  constructor(
    options: StreamControllerOptions
  ) {
    this.rtcManager = options.rtcManager;
    this.roomController =
      options.roomController ??
      new RoomController({ rtcManager: options.rtcManager });
    this.encodingController =
      options.encodingController ??
      new EncodingController({ rtcManager: options.rtcManager });

    this.errorListener = options.errorListener ?? (() => { });
    this.remoteStreamListener = options.remoteStreamListener ?? (() => { });
    this.generationTimeoutMs = options.generationTimeoutMs ?? 30_000;

    this.roomController.setListener({
      onRoomMessage: (
        sender,
        message
      ) => {
        this.roomListener?.onRoomMessage(
          sender,
          message
        );
      },
    });

    // The transport owns RTC events and delegates room message reassembly and delivery.
    this.rtcManager.setEventListener({
      onTokenWillExpire: options.onCredentialsRequired,
      onTokenExpired: options.onCredentialsRequired,
      onRoomRejoining: () => this.handleRoomRejoining(),
      onError: (error) => this.errorListener(error),
      onNetworkStatistics: (statistics) => {
        if (this.state.roomID) {
          this.networkStatisticsListener?.(statistics);
        }
      },
      onRemoteVideoStatistics: (statistics) => {
        const userID = this.state.activeRemoteStream?.userID;
        this.remoteVideoStatisticsListener?.(
          userID ? statistics.find((item) => item.userID === userID) : undefined,
        );
      },
      onLocalVideoStatistics: (statistics) => {
        if (this.state.localVideoPublished) {
          this.localVideoStatisticsListener?.(statistics);
        }
      },
      onCustomMessageReceived: (
        senderUserID,
        message
      ) => {
        this.roomController.handleIncomingMessage(
          senderUserID,
          message
        );
      },
      onRemoteVideoPublished: (
        userID,
        published
      ) => {
        void this.handleRemoteVideoPublished(
          userID,
          published
        );
      },
      onRemoteAudioTrackChanged: userID => {
        if (this.state.activeRemoteStream?.userID === userID) {
          this.notifyRemoteMedia();
        }
      },
    });
  }

  /**
   * Whether a generation task is starting or running.
   */
  get hasGenerationTask(): boolean {
    return this.state.generationTaskID !== undefined;
  }

  /**
   * Replaces the original-track observer and immediately reports the current binding without changing
   * RTC event ownership.
   */
  setRemoteMediaListener(
    listener?: (
      tracks?: RemoteMediaTracks
    ) => void
  ): void {
    this.remoteMediaListener = listener;
    this.notifyRemoteMedia();
  }

  /**
   * Delivers the active result user's tracks to the observer while isolating track-access failures.
   */
  private notifyRemoteMedia(): void {
    if (!this.remoteMediaListener) {
      return;
    }
    const userID = this.state.activeRemoteStream?.userID;
    const videoTrack = userID && this.state.remoteVideoTracks.get(userID);
    const bindingID = this.state.generationTaskID;
    try {
      this.remoteMediaListener(userID && videoTrack && bindingID ? {
        userID,
        bindingID,
        videoTrack,
        audioTrack: this.rtcManager.getRemoteAudioTrack(userID),
      } : undefined);
    } catch (error) {
      XmaxLogger.stream.warning(() => `Unable to observe remote media tracks: ${XmaxError.from(error).message}`);
    }
  }

  /**
   * Sets the uplink statistics listener without replacing the RTC event listener.
   */
  setUplinkVideoStatisticsListener(
    listener?: UplinkVideoStatisticsListener
  ): void {
    this.localVideoStatisticsListener = listener;
  }

  /**
   * Sets the network statistics listener; notifications do not depend on a remote user and may arrive
   * after publication.
   */
  setNetworkQualityListener(
    listener?: RealtimeNetworkQualityListener
  ): void {
    this.networkStatisticsListener = listener;
  }

  /**
   * Observes statistics for the accepted result publisher rather than assuming the session's bot ID is
   * the publisher.
   */
  setDownlinkVideoStatisticsListener(
    listener?: DownlinkVideoStatisticsListener
  ): void {
    this.remoteVideoStatisticsListener = listener;
  }

  /**
   * The generated audio playback volume, from 0 to 1.
   */
  get remoteAudioVolume(): number {
    return this.remoteAudioVolumePercentage / 100;
  }

  /**
   * Sets the generated audio playback volume for all subscribed remote audio.
   */
  setRemoteAudioVolume(
    volume: number
  ): void {
    const rtcVolume = Math.min(Math.max(Math.round(volume * 100), 0), 100);
    for (const userID of [...this.state.subscribedRemoteAudioUserIDs].sort()) {
      this.rtcManager.setRemoteAudioVolume(
        rtcVolume,
        userID
      );
    }
    this.remoteAudioVolumePercentage = rtcVolume;
  }

  /**
   * Applies the uplink video format, bitrate range, and encoding policy.
   *
   * @throws Rejects if the format or bitrate range is invalid, or RTC configuration fails.
   */
  async updateUplinkVideoFormat(
    videoFormat: RealtimeVideoFormat
  ): Promise<void> {
    await this.encodingController.configure(videoFormat);
  }

  /**
   * Updates the target frame rate without recalculating the bitrate range.
   */
  async updateUplinkFrameRate(
    fps: number
  ): Promise<RealtimeVideoFormat> {
    return this.encodingController.updateFrameRate(fps);
  }

  /**
   * Joins the RTC room and publishes local media.
   *
   * @throws Rejects if the connection is canceled or joining, room configuration, or publication fails.
   */
  async connect(
    connection: RtcSessionConnection,
    includeLocalAudio: boolean,
    ensureActive: () => void,
    beforePublish?: () => Promise<void>,
    measureRtcJoin?: () => () => void,
  ): Promise<void> {
    this.configureRoom({
      roomID: connection.roomID,
      botID: connection.botID
    });
    await this.roomController.join(
      connection,
      ensureActive,
      measureRtcJoin
    );
    ensureActive();

    XmaxLogger.stream.info(
      () =>
        `RTC 房间已配置 (RTC Room Configured)\n` +
        `└─ roomID: ${connection.roomID}, botID: ${connection.botID ?? "(未设置)"}`,
    );

    await beforePublish?.();
    ensureActive();
    await this.publishLocalStream(includeLocalAudio);
  }

  /**
   * Clears generation state, local publication, and remote subscriptions, then leaves the room.
   */
  async disconnect(): Promise<void> {
    await this.resetStream();
    await this.roomController.leave();
  }

  /**
   * Applies refreshed session credentials to the active RTC connection.
   */
  async updateCredentials(
    connection: RtcSessionConnection,
    signal?: AbortSignal
  ): Promise<void> {
    await this.rtcManager.updateCredentials(
      toRoomJoinConfiguration(connection),
      signal
    );
  }

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
   * @returns A promise that waits for the remote result stream to confirm generation.
   * @throws Throws synchronously for an invalid task ID, an unready room, a pending start, or a running
   * task without restart. The returned promise rejects if sending fails or confirmation times out.
   */
  beginGeneration(
    options: StreamGenerationOptions
  ): Promise<void> {
    const taskID = options.taskID.trim();
    if (!taskID) {
      throw new XmaxError(
        XmaxErrorCode.invalidConfiguration,
        "Realtime generation task ID cannot be empty",
      );
    }
    if (!this.state.roomID) {
      throw new XmaxError(
        XmaxErrorCode.rtcError,
        "RTC room is not configured"
      );
    }
    if (this.state.generationTaskID && (!options.restart || this.state.generationWaiter)) {
      throw new XmaxError(
        XmaxErrorCode.rtcError,
        "Realtime generation is already active",
      );
    }

    let resolve!: () => void;
    let reject!: (
      error: XmaxError
    ) => void;
    const confirmation = new Promise<void>((
      res,
      rej
    ) => {
      resolve = res;
      reject = rej;
    });
    const waiter: GenerationWaiter = {
      taskID,
      resolve,
      reject,
      confirmationPending: false,
      timeoutTimer: setTimeout(
        () => {
          this.rejectGenerationStart(
            taskID,
            new XmaxError(
              XmaxErrorCode.timeout,
              "Realtime generation start timed out",
            ),
          );
        },
        this.generationTimeoutMs
      ),
    };

    this.state.generationTaskID = taskID;
    this.state.generationWaiter = waiter;
    // Observe early confirmation rejection because sending may fail before the caller awaits it.
    void confirmation.catch(() => { });

    try {
      const sending = this.roomController.startGeneration({
        taskID,
        videoFormat: options.videoFormat,
        context: options.context,
        targetSize: options.targetSize,
        mirror: options.mirror ?? false,
        faceRestoration: options.faceRestoration ?? false,
        paddingContain: options.paddingContain,
        extraParams: options.extraParams,
      });
      const state = this.state;
      const sent = Promise.resolve(sending).then(async () => {
        if (this.state !== state || state.generationTaskID !== taskID) {
          return;
        }
        await options.onStartSent?.();
        if (this.state !== state || state.generationTaskID !== taskID) {
          return;
        }
        // The bot may publish before start; reuse its subscribed track rather than waiting for a second publication event.
        for (const userID of state.publishedRemoteUserIDs) {
          void this.handleRemoteVideoPublished(
            userID,
            true
          );
        }
      }).catch(error => {
        const mapped = XmaxError.from(error);
        this.rejectGenerationStart(
          taskID,
          mapped
        );
        if (this.state.generationTaskID === taskID) {
          this.state.generationTaskID = undefined;
          void this.roomController.stopGeneration(taskID).catch(() => { });
        }
        throw mapped;
      });
      return Promise.all([sent, confirmation]).then(() => { });
    } catch (error) {
      const mapped = XmaxError.from(error);
      this.rejectGenerationStart(
        taskID,
        mapped
      );
      this.state.generationTaskID = undefined;
      try {
        void this.roomController.stopGeneration(taskID).catch(() => { });
      } catch {
        // A failed cleanup stop must not replace the original start-message error.
      }
      throw mapped;
    }
  }

  /**
   * Subscribes to the active result stream's audio after its first frame is displayable.
   *
   * @throws Rejects if generation is unconfirmed or RTC volume or subscription configuration fails.
   */
  async activateRemoteAudio(): Promise<void> {
    const remoteStream = this.state.generationTaskID
      ? this.state.activeRemoteStream
      : undefined;
    if (!remoteStream) {
      throw new XmaxError(
        XmaxErrorCode.rtcError,
        "Remote generation audio stream is unavailable",
      );
    }
    await this.subscribeRemoteAudio(remoteStream.userID);
  }

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
  async updateGeneration(
    options: StreamGenerationOptions
  ): Promise<void> {
    try {
      await this.roomController.changeGenerationCondition({
        taskID: options.taskID,
        videoFormat: options.videoFormat,
        context: options.context,
        targetSize: options.targetSize,
        faceRestoration: options.faceRestoration ?? false,
        paddingContain: options.paddingContain,
        extraParams: options.extraParams,
      });
    } catch (error) {
      throw XmaxError.from(error);
    }
  }

  /**
   * Updates returned video dimensions without restarting generation.
   *
   * @throws Rejects if the operation is canceled, the room is not ready, or sending fails.
   */
  async updateDownlinkVideoResolution(
    taskID: string,
    targetSize: ModelSize,
    ensureActive: () => void,
  ): Promise<void> {
    try {
      await this.roomController.changeTargetSize({
        taskID,
        targetSize,
        ensureActive
      });
    } catch (error) {
      throw XmaxError.from(error);
    }
  }

  /**
   * Stops generation and clears its result stream; an empty identifier stops the current task.
   *
   * @throws Rejects if the stop message cannot be sent.
   */
  async stopGeneration(
    taskID: string
  ): Promise<void> {
    const stoppedTaskID = await this.stopStreamGeneration(taskID);
    if (taskID && !stoppedTaskID) {
      return;
    }
    try {
      await this.roomController.stopGeneration(stoppedTaskID);
    } catch (error) {
      throw XmaxError.from(error);
    }
  }

  /**
   * Sends interaction points; ignores an empty point list.
   *
   * @throws Rejects if the room is not ready or sending fails.
   */
  async sendTracks(
    taskID: string,
    points: RealtimePoint[]
  ): Promise<void> {
    try {
      await this.roomController.sendTracks(
        taskID,
        points
      );
    } catch (error) {
      throw XmaxError.from(error);
    }
  }

  /**
   * Sets the room message listener; an undefined value clears it.
   */
  setRoomListener(
    listener?: RoomListener
  ): void {
    this.roomListener = listener;
  }

  /**
   * Configures the room; rejects reconfiguration with active publication, subscriptions, or generation.
   */
  private configureRoom(
    options: {
      roomID: string;
      botID?: string
    }
  ): void {
    const roomID = options.roomID.trim();
    const botID = options.botID?.trim() ?? "";
    if (!roomID) {
      throw new XmaxError(
        XmaxErrorCode.invalidConfiguration,
        "RTC room ID cannot be empty",
      );
    }
    if (
      this.state.localVideoPublished ||
      this.state.localAudioPublished ||
      this.state.subscribedRemoteUserIDs.size > 0 ||
      this.state.generationTaskID
    ) {
      throw new XmaxError(
        XmaxErrorCode.invalidConfiguration,
        "Reset the current RTC room before configuring another one",
      );
    }

    this.state.roomID = roomID;
    this.state.botID = botID;
  }

  /**
   * Publishes local video and optional audio; rolls video publication back if audio publication fails.
   */
  private async publishLocalStream(
    includeAudio: boolean
  ): Promise<void> {
    if (!this.state.roomID) {
      throw new XmaxError(
        XmaxErrorCode.invalidConfiguration,
        "Configure an RTC room before publishing the local stream",
      );
    }
    let publishedVideoInOperation = false;
    try {
      if (!this.state.localVideoPublished) {
        await this.rtcManager.publishLocalVideo();
        this.state.localVideoPublished = true;
        publishedVideoInOperation = true;
      }
      if (includeAudio && !this.state.localAudioPublished) {
        await this.rtcManager.publishLocalAudio();
        this.state.localAudioPublished = true;
      }
    } catch (error) {
      if (publishedVideoInOperation) {
        await this.rollbackLocalVideoPublication();
      }
      throw XmaxError.from(error);
    }
  }

  /**
   * Handles remote video publication by subscribing or clearing its binding.
   */
  private async handleRemoteVideoPublished(
    userID: string,
    published: boolean,
  ): Promise<void> {
    const trimmedUserID = userID.trim();
    if (!trimmedUserID) {
      return;
    }

    XmaxLogger.stream.info(
      () =>
        `远端视频发布状态变化 (Remote Video Publication Changed)\n` +
        `└─ userID: ${trimmedUserID}, published: ${published}`,
    );

    if (!this.state.roomID) {
      return;
    }
    if (published) {
      this.state.publishedRemoteUserIDs.add(trimmedUserID);
    }
    else {
      this.state.publishedRemoteUserIDs.delete(trimmedUserID);
      this.state.remoteVideoSubscriptions.delete(trimmedUserID);
      this.state.remoteVideoTracks.delete(trimmedUserID);
    }
    if (this.state.botID && this.state.botID !== trimmedUserID) {
      // Accept a different publisher while generation is pending or active: this session's
      // private room contains only the local user and result bot.

      if (this.state.generationTaskID === undefined) {
        XmaxLogger.stream.warning(
          () =>
            `忽略非目标机器人的远端视频 (Ignored Remote Video from Non-Bot User)\n` +
            `└─ userID: ${trimmedUserID}, botID: ${this.state.botID}`,
        );
        return;
      }
      XmaxLogger.stream.warning(
        () =>
          `远端视频发布者与会话下发的机器人标识不一致，按生成结果流接受 (Accepted Remote Video Despite Bot ID Mismatch)\n` +
          `└─ userID: ${trimmedUserID}, botID: ${this.state.botID}`,
      );
    }

    if (published) {
      await this.subscribeRemoteVideo(trimmedUserID);
      return;
    }

    this.state.subscribedRemoteUserIDs.delete(trimmedUserID);
    if (this.state.activeRemoteStream?.userID === trimmedUserID) {
      await this.unsubscribeRemoteAudio(trimmedUserID);
      this.state.activeRemoteStream = undefined;
      this.clearRemoteStream();
    }
  }

  /**
   * Discards obsolete media bindings on RTC rejoin while preserving the task, audio subscription intent,
   * and generation waiter.
   */
  private handleRoomRejoining(): void {
    this.state.publishedRemoteUserIDs.clear();
    this.state.subscribedRemoteUserIDs.clear();
    this.state.remoteVideoSubscriptions.clear();
    this.state.remoteVideoTracks.clear();
    this.state.activeRemoteStream = undefined;
    this.clearRemoteStream();
  }

  /**
   * Subscribes to remote video, then confirms generation or updates its result binding.
   */
  private async subscribeRemoteVideo(
    userID: string
  ): Promise<void> {
    const state = this.state;
    const existing = state.remoteVideoTracks.get(userID);
    if (existing) {
      if (state.generationWaiter) {
        this.confirmOrUpdateRemoteStream(
          userID,
          existing
        );
      }
      return;
    }
    if (state.remoteVideoSubscriptions.has(userID)) {
      return;
    }
    const subscription = {};
    state.remoteVideoSubscriptions.set(
      userID,
      subscription
    );
    const isCurrent = () => this.state === state && state.remoteVideoSubscriptions.get(userID) === subscription;

    try {
      const track = await this.rtcManager.subscribeRemoteVideo(
        userID,
        true
      );
      if (!isCurrent()) {
        return;
      }
      if (!track) {
        throw new XmaxError(
          XmaxErrorCode.mediaError,
          "Remote video track is not available",
        );
      }

      state.subscribedRemoteUserIDs.add(userID);
      state.remoteVideoTracks.set(
        userID,
        track
      );
      XmaxLogger.stream.info(
        () =>
          `远端视频订阅成功 (Remote Video Subscribed)\n` +
          `└─ userID: ${userID}`,
      );
      this.confirmOrUpdateRemoteStream(
        userID,
        track
      );
    } catch (error) {
      if (!isCurrent()) {
        return;
      }
      const mapped = XmaxError.from(error);
      const pendingTaskID = this.state.generationWaiter
        ? this.state.generationTaskID
        : undefined;
      if (pendingTaskID) {
        this.rejectGenerationStart(
          pendingTaskID,
          mapped
        );
      } else {
        this.errorListener(mapped);
      }
    } finally {
      if (isCurrent()) {
        state.remoteVideoSubscriptions.delete(userID);
      }
    }
  }

  /**
   * Accepts a subscribed result stream, confirming a pending task or replacing the current binding.
   */
  private confirmOrUpdateRemoteStream(
    userID: string,
    track: MediaStreamTrack,
  ): void {
    const waiter = this.state.generationWaiter;
    const taskID = this.state.generationTaskID;
    const stream = new RemoteStream({
      roomID: this.state.roomID,
      userID
    });

    if (waiter && taskID) {
      if (waiter.confirmationPending) {
        return;
      }
      waiter.confirmationPending = true;
      try {
        this.remoteStreamListener({
          stream,
          videoTrack: track
        });
        if (this.state.generationTaskID === taskID) {
          this.state.activeRemoteStream = stream;
          this.notifyRemoteMedia();
        }
      } catch (error) {
        this.rejectGenerationStart(
          taskID,
          XmaxError.from(error)
        );
        return;
      }
      this.resolveGenerationStart(taskID);
      return;
    }

    // The result bot has republished after confirmation; update the active stream and binding.
    if (taskID) {
      try {
        this.remoteStreamListener({
          stream,
          videoTrack: track
        });
        if (this.state.generationTaskID === taskID) {
          this.state.activeRemoteStream = stream;
          this.notifyRemoteMedia();
        }
      } catch (error) {
        this.errorListener(XmaxError.from(error));
      }
    }
  }

  /**
   * Subscribes to remote audio and applies the current volume using platform capabilities.
   *
   * Set the volume before subscribing where supported to avoid brief default-volume playback. Where
   * volume control falls back to playback or mute, subscribe first and then mute so resumed playback
   * does not override zero volume.
   */
  private async subscribeRemoteAudio(
    userID: string
  ): Promise<void> {
    if (this.state.subscribedRemoteAudioUserIDs.has(userID)) {
      return;
    }
    if (this.rtcManager.supportsRemoteAudioVolumeControl) {
      this.rtcManager.setRemoteAudioVolume(
        this.remoteAudioVolumePercentage,
        userID
      );
      await this.rtcManager.subscribeRemoteAudio(
        userID,
        true
      );
    } else {
      await this.rtcManager.subscribeRemoteAudio(
        userID,
        true
      );
      this.rtcManager.setRemoteAudioVolume(
        this.remoteAudioVolumePercentage,
        userID
      );
    }
    this.state.subscribedRemoteAudioUserIDs.add(userID);
    this.notifyRemoteMedia();
  }

  /**
   * Unsubscribes from remote audio and logs failures without propagating them.
   */
  private async unsubscribeRemoteAudio(
    userID: string
  ): Promise<void> {
    if (!this.state.subscribedRemoteAudioUserIDs.delete(userID)) {
      return;
    }
    await this.performCleanup(
      "取消订阅 RTC 远端音频失败 (Failed to Unsubscribe from RTC Remote Audio)",
      () => this.rtcManager.subscribeRemoteAudio(
        userID,
        false
      ),
    );
  }

  /**
   * Stops the matching task, rejects its waiter, and clears its result stream and audio subscriptions.
   *
   * @returns The stopped task identifier, or an empty string when no task matches.
   */
  private async stopStreamGeneration(
    taskID: string,
    reason = "Realtime generation start cancelled",
  ): Promise<string> {
    const currentTaskID = this.state.generationTaskID ?? "";
    if (taskID && taskID !== currentTaskID) {
      return "";
    }

    const waiter = this.state.generationWaiter;
    const remoteAudioUserIDs = [...this.state.subscribedRemoteAudioUserIDs];
    this.state.generationTaskID = undefined;
    this.state.generationWaiter = undefined;
    this.state.activeRemoteStream = undefined;
    this.state.subscribedRemoteAudioUserIDs.clear();

    if (waiter) {
      clearTimeout(waiter.timeoutTimer);
      waiter.reject(new XmaxError(
        XmaxErrorCode.cancelled,
        reason
      ));
    }

    for (const userID of remoteAudioUserIDs.sort()) {
      await this.performCleanup(
        "取消订阅 RTC 远端音频失败 (Failed to Unsubscribe from RTC Remote Audio)",
        () => this.rtcManager.subscribeRemoteAudio(
          userID,
          false
        ),
      );
    }

    this.clearRemoteStream();

    return currentTaskID;
  }

  /**
   * Stops generation, removes all remote subscriptions, and unpublishes local media.
   */
  private async resetStream(): Promise<void> {
    await this.stopStreamGeneration("");

    const previousState = this.state;
    this.state = makeInitialState();

    for (const userID of [...previousState.subscribedRemoteUserIDs].sort()) {
      await this.performCleanup(
        "取消订阅 RTC 远端视频失败 (Failed to Unsubscribe from RTC Remote Video)",
        async () => {
          await this.rtcManager.subscribeRemoteVideo(
            userID,
            false
          );
        },
      );
    }

    if (previousState.localAudioPublished) {
      await this.performCleanup(
        "取消发布 RTC 本地音频失败 (Failed to Unpublish RTC Local Audio)",
        () => this.rtcManager.unpublishLocalAudio(),
      );
    }

    if (previousState.localVideoPublished) {
      await this.performCleanup(
        "取消发布 RTC 本地视频失败 (Failed to Unpublish RTC Local Video)",
        () => this.rtcManager.unpublishLocalVideo(),
      );
    }
  }

  /**
   * Clears the waiter and resolves generation confirmation.
   */
  private resolveGenerationStart(
    taskID: string
  ): void {
    const waiter = this.state.generationWaiter;
    if (this.state.generationTaskID !== taskID || waiter?.taskID !== taskID) {
      return;
    }
    this.state.generationWaiter = undefined;
    clearTimeout(waiter.timeoutTimer);
    waiter.resolve();
  }

  /**
   * Clears the waiter and rejects generation confirmation.
   */
  private rejectGenerationStart(
    taskID: string,
    error: XmaxError
  ): void {
    const waiter = this.state.generationWaiter;
    if (this.state.generationTaskID !== taskID || waiter?.taskID !== taskID) {
      return;
    }
    this.state.generationWaiter = undefined;
    clearTimeout(waiter.timeoutTimer);
    waiter.reject(error);
  }

  /**
   * Notifies observers that the generated stream was cleared; logs listener failures.
   */
  private clearRemoteStream(): void {
    this.remoteMediaListener?.(undefined);
    this.remoteVideoStatisticsListener?.(undefined);
    try {
      this.remoteStreamListener(null);
    } catch (error) {
      XmaxLogger.stream.error(
        () =>
          `清理 RTC 远端生成流失败 (Failed to Clean Up RTC Remote Generation Stream)\n` +
          `└─ ${XmaxLogger.localized("原因：", "Reason: ")}${XmaxError.from(error).message}`,
      );
    }
  }

  /**
   * Rolls back local video publication and logs failures.
   */
  private async rollbackLocalVideoPublication(): Promise<void> {
    await this.performCleanup(
      "回滚 RTC 本地视频发布失败 (Failed to Roll Back RTC Local Video Publication)",
      async () => {
        await this.rtcManager.unpublishLocalVideo();
        this.state.localVideoPublished = false;
      },
    );
  }

  /**
   * Runs a cleanup action and logs failures without propagating them.
   */
  private async performCleanup(
    title: string,
    action: () => Promise<void> | void,
  ): Promise<void> {
    try {
      await action();
    } catch (error) {
      XmaxLogger.stream.error(
        () =>
          `${title}\n` +
          `└─ ${XmaxLogger.localized("原因：", "Reason: ")}${XmaxError.from(error).message}`,
      );
    }
  }
}
