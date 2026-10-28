//
//  RoomController.ts
//  XmaxSDK
//
//  Author: 翁跃庭 (Yueting Weng)
//  GitHub: https://github.com/Xmax-AI/XmaxSDK-Web
//
//  Copyright (c) 2026 XMAX.AI PTE. LTD.
//

import { RtcProvider } from "../../Foundation/RTC/RtcProvider";
import { XmaxError, XmaxErrorCode } from "../../Foundation/Errors/XmaxError";
import { XmaxLogger } from "../../Foundation/Logging/XmaxLogger";
import { toRoomJoinConfiguration } from "../../Service/Realtime/RealtimeSessionConnection";
import type { RtcManaging } from "../../Foundation/RTC/RtcManaging";
import type { RealtimeContext } from "../../Service/Realtime/RealtimeContext";
import type { RealtimeExtraParams } from "../../Service/Realtime/RealtimeExtraParams";
import type { RealtimePoint } from "../../Service/Realtime/RealtimePoint";
import type { RtcSessionConnection } from "../../Service/Realtime/RealtimeSessionConnection";
import type { RealtimeVideoFormat } from "../../Service/Realtime/RealtimeVideoFormat";
import type { RoomControlling, RoomListener } from "./RoomControlling";
import { RoomEvent, type RoomEventTargetSize } from "./RoomEvent";
import { EncodingBitratePolicy } from "../Encoding/EncodingBitratePolicy";
import { RoomHeartbeat } from "./RoomHeartbeat";
import { RoomMessageCodec } from "./RoomMessageCodec";

/**
 * The lifecycle state of an RTC room.
 */
type RoomState =
  | {

    /**
     * No room operation is active.
     */
    kind: "idle"
  }
  | {

    /**
     * An RTC room join is in progress.
     */
    kind: "joining";

    /**
     * Identifies the join operation across asynchronous boundaries.
     */
    operationID: string
  }
  | {

    /**
     * The RTC room has been joined.
     */
    kind: "joined";

    /**
     * The local user identifier in the joined room.
     */
    userID: string
  }
  | {

    /**
     * The RTC room is being released.
     */
    kind: "leaving"
  };

/**
 * Dependencies for room transport, message fragmentation, and heartbeat scheduling.
 */
export interface RoomControllerOptions {

  /**
   * The RTC engine and room transport.
   */
  rtcManager: RtcManaging;

  /**
   * An optional heartbeat scheduler.
   */
  heartbeat?: RoomHeartbeat;

  /**
   * An optional room message codec.
   */
  codec?: RoomMessageCodec;
}

/**
 * Manages RTC room membership, heartbeats, and generation signaling.
 *
 * Incoming messages are reassembled, filtered by the target `user_id` in the broadcast payload, and
 * delivered to the listener.
 */
export class RoomController implements RoomControlling {

  /**
   * The RTC engine used for room operations.
   */
  private readonly rtcManager: RtcManaging;

  /**
   * The scheduler that sends room heartbeats.
   */
  private readonly heartbeat: RoomHeartbeat;

  /**
   * The message codec used by the current room.
   */
  private codec: RoomMessageCodec;

  /**
   * Whether the message codec was supplied by the caller.
   */
  private readonly customCodec: boolean;

  /**
   * The task chain that serializes control messages.
   */
  private sendTail: Promise<void> = Promise.resolve();

  /**
   * The receiver for complete room messages.
   */
  private listener?: RoomListener;

  /**
   * The current membership and user identity.
   */
  private state: RoomState = { kind: "idle" };

  /**
   * The shared room-leaving and cleanup operation.
   */
  private leaveOperation?: Promise<void>;

  /**
   * Creates a room controller.
   */
  constructor(
    options: RoomControllerOptions
  ) {
    this.rtcManager = options.rtcManager;
    this.heartbeat =
      options.heartbeat ?? new RoomHeartbeat({ rtcManager: options.rtcManager });
    this.codec = options.codec ?? new RoomMessageCodec();
    this.customCodec = options.codec !== undefined;
  }

  /**
   * Joins an RTC room while checking that the connection operation remains active.
   *
   * @throws Rejects if a previous room is still active, the operation is obsolete, or joining fails.
   */
  async join(
    connection: RtcSessionConnection,
    ensureActive: () => void,
    measureRtcJoin?: () => () => void,
  ): Promise<void> {
    try {
      ensureActive();
    } catch (error) {
      throw XmaxError.from(error);
    }
    if (this.state.kind !== "idle" || this.leaveOperation) {
      throw new XmaxError(
        XmaxErrorCode.invalidConfiguration,
        "Leave the current RTC room before joining another one",
      );
    }

    const operationID = `join-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
    this.state = {
      kind: "joining",
      operationID
    };
    this.heartbeat.stop();

    try {
      if (!this.customCodec) {
        this.codec = new RoomMessageCodec(
          connection.provider === RtcProvider.vertc
            ? null
            : connection.provider === RtcProvider.agora ? "__agora_chunk__" : "__trtc_chunk__",
        );
      }
      const configuration = toRoomJoinConfiguration(connection);
      const completeRtcJoin = measureRtcJoin?.();
      await this.rtcManager.joinRoom(configuration);
      ensureActive();
      if (
        this.state.kind !== "joining" ||
        this.state.operationID !== operationID ||
        this.leaveOperation
      ) {
        throw new XmaxError(
          XmaxErrorCode.cancelled,
          "RTC room join was cancelled"
        );
      }

      completeRtcJoin?.();

      this.state = {
        kind: "joined",
        userID: connection.userID
      };
      this.heartbeat.start(connection.userID);
    } catch (error) {
      if (
        this.state.kind === "joining" &&
        this.state.operationID === operationID &&
        !this.leaveOperation
      ) {
        this.state = { kind: "leaving" };
        this.heartbeat.stop();
        await this.rtcManager.leaveRoom();
        if (this.state.kind === "leaving") {
          this.state = { kind: "idle" };
        }
      }
      throw XmaxError.from(error);
    }
  }

  /**
   * Stops heartbeats and leaves the RTC room; concurrent calls share the same operation.
   */
  async leave(): Promise<void> {
    if (this.leaveOperation) {
      await this.leaveOperation;
      return;
    }
    if (this.state.kind === "idle" || this.state.kind === "leaving") {
      return;
    }
    const operation = this.performLeave();
    this.leaveOperation = operation;
    await operation;
  }

  /**
   * Sends a generation-start message.
   *
   * @param options.taskID - The generation task identifier.
   * @param options.videoFormat - The generation video format.
   * @param options.context - The generation conditions.
   * @param options.targetSize - The returned video dimensions, omitted when unset.
   * @param options.mirror - Whether the server mirrors the input; defaults to false.
   * @param options.faceRestoration - Whether to restore the original face; defaults to false.
   * @param options.extraParams - Parameters merged into this start message without being retained.
   * @throws Rejects if the room is not ready or sending fails.
   */
  startGeneration(
    options: {
      taskID: string;
      videoFormat: RealtimeVideoFormat;
      context: RealtimeContext;
      targetSize?: RoomEventTargetSize;
      mirror?: boolean;
      faceRestoration?: boolean;
      paddingContain?: boolean;
      extraParams?: RealtimeExtraParams;
    }
  ): Promise<void> {
    return this.send(
      RoomEvent.start({
        userID: this.requireUserID(),
        taskID: options.taskID,
        videoFormat: options.videoFormat,
        context: options.context,
        targetSize: options.targetSize,
        mirror: options.mirror ?? false,
        faceRestoration: options.faceRestoration ?? false,
        paddingContain: options.paddingContain,
        extraParams: options.extraParams,
        ...this.downlinkBitrates(options.targetSize ?? options.videoFormat),
      }),
    );
  }

  /**
   * Sends updated generation conditions.
   *
   * @param options.taskID - The generation task identifier.
   * @param options.videoFormat - The generation video format.
   * @param options.context - The updated generation conditions.
   * @param options.targetSize - The returned video dimensions, omitted when unset.
   * @param options.faceRestoration - Whether to restore the original face; defaults to false.
   * @param options.extraParams - Parameters merged into this change_condition message without being
   * retained.
   * @throws Rejects if the room is not ready or sending fails.
   */
  changeGenerationCondition(
    options: {
      taskID: string;
      videoFormat: RealtimeVideoFormat;
      context: RealtimeContext;
      targetSize?: RoomEventTargetSize;
      faceRestoration?: boolean;
      paddingContain?: boolean;
      extraParams?: RealtimeExtraParams;
    }
  ): Promise<void> {
    return this.send(
      RoomEvent.changeCondition({
        userID: this.requireUserID(),
        taskID: options.taskID,
        videoFormat: options.videoFormat,
        context: options.context,
        targetSize: options.targetSize,
        faceRestoration: options.faceRestoration ?? false,
        paddingContain: options.paddingContain,
        extraParams: options.extraParams,
      }),
    );
  }

  /**
   * Updates the returned video dimensions for the current task.
   *
   * @throws Rejects if the operation is canceled, the room is not ready, or sending fails.
   */
  changeTargetSize(
    options: {
      taskID: string;
      targetSize: RoomEventTargetSize;
      ensureActive: () => void;
    }
  ): Promise<void> {
    options.ensureActive();
    return this.send(
      RoomEvent.changeTargetSize({
        userID: this.requireUserID(),
        taskID: options.taskID,
        targetSize: options.targetSize,
        ...this.downlinkBitrates(options.targetSize),
      }),
    );
  }

  /**
   * Estimates downlink bitrates from the returned dimensions at 24 fps, with a maximum between 100 and
   * 10000 kbps.
   *
   * This estimate neither sets the server frame rate nor reuses an explicit uplink bitrate.
   */
  private downlinkBitrates(
    size: RoomEventTargetSize
  ): {
    minimumBitrate: number;
    maximumBitrate: number
  } {
    const { maximum } = EncodingBitratePolicy.resolve(
      Math.round(size.width),
      Math.round(size.height),
      24,
    );
    return {
      minimumBitrate: 100,
      maximumBitrate: Math.min(10000, maximum)
    };
  }

  /**
   * Attempts to stop generation; ignores calls without a joined room or task identifier.
   */
  stopGeneration(
    taskID: string
  ): Promise<void> {
    if (!taskID || this.state.kind !== "joined") {
      return Promise.resolve();
    }
    return this.send(RoomEvent.stop({
      userID: this.state.userID,
      taskID
    }));
  }

  /**
   * Sends interaction points; ignores an empty task identifier or point list.
   */
  sendTracks(
    taskID: string,
    points: RealtimePoint[]
  ): Promise<void> {
    if (!taskID || points.length === 0) {
      return Promise.resolve();
    }
    return this.send(
      RoomEvent.tracks({
        userID: this.requireUserID(),
        taskID,
        points,
      }),
      "latest",
    );
  }

  /**
   * Sets the room message listener; an undefined value clears it.
   */
  setListener(
    listener?: RoomListener
  ): void {
    this.listener = listener;
  }

  /**
   * Resets room state, stops heartbeats, clears partial messages, and leaves the room.
   */
  private async performLeave(): Promise<void> {
    this.state = { kind: "idle" };
    this.heartbeat.stop();
    this.codec.reset();
    this.sendTail = Promise.resolve();
    try {
      await this.rtcManager.leaveRoom();
    }
    finally {
      this.leaveOperation = undefined;
    }
  }

  /**
   * Reassembles incoming messages and delivers those addressed to the current user.
   */
  handleIncomingMessage(
    senderUserID: string,
    raw: string
  ): void {
    const parsed = this.codec.processIncoming(
      senderUserID,
      raw
    );
    if (typeof parsed !== "object" || parsed === null) {
      return;
    }

    const message = parsed as Record<string, unknown>;

    // RTC messages are broadcast; filter the intended recipient using the payload's user_id.
    const targetUserID =
      typeof message.user_id === "string" ? message.user_id : undefined;
    const ownUserID = this.state.kind === "joined" ? this.state.userID : undefined;
    if (targetUserID && ownUserID && targetUserID !== ownUserID) {
      return;
    }

    this.listener?.onRoomMessage(
      senderUserID,
      message
    );
  }

  /**
   * Serializes acknowledged control messages; snapshots wait for prior controls without blocking later
   * controls.
   */
  private send(
    message: string,
    delivery: "ordered" | "latest" = "ordered",
  ): Promise<void> {
    const state = this.state;
    const packets = this.codec.encodeOutgoing(message);
    // Confirm each fragment in order so replacing a snapshot cannot leave an incomplete message.
    const mode = packets.length > 1 ? "ordered" : delivery;
    const operation = this.sendTail.then(async () => {
      for (const packet of packets) {
        if (state !== this.state || state.kind !== "joined") {
          throw new XmaxError(
            XmaxErrorCode.cancelled,
            "Room message was cancelled"
          );
        }
        if (mode === "latest") {
          await this.rtcManager.sendRoomMessage(
            packet,
            "latest"
          );
        } else {
          await this.rtcManager.sendRoomMessage(
            packet,
            "barrier"
          );
        }
      }
      XmaxLogger.room.info(
        () =>
          `发送房间信令 (Outbound Room Signaling)\n` +
          `└─ ${XmaxLogger.localized("内容：", "Content:")}\n${JSON.stringify(JSON.parse(message), null, 2)}`,
      );
    }).catch(error => {
      throw XmaxError.from(error);
    });
    if (mode === "ordered") {
      this.sendTail = operation.catch(() => { });
    }
    return operation;
  }

  /**
   * Returns the current room user identifier; throws if the room has not been joined.
   */
  private requireUserID(): string {
    if (this.state.kind !== "joined") {
      throw new XmaxError(
        XmaxErrorCode.rtcError,
        "RTC room is not joined"
      );
    }
    return this.state.userID;
  }
}
