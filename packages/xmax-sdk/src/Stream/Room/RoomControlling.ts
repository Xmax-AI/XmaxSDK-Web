//
//  RoomControlling.ts
//  XmaxSDK
//
//  Author: 翁跃庭 (Yueting Weng)
//  GitHub: https://github.com/Xmax-AI/XmaxSDK-Web
//
//  Copyright (c) 2026 XMAX.AI PTE. LTD.
//

import type { RealtimeContext } from "../../Service/Realtime/RealtimeContext";
import type { RealtimeExtraParams } from "../../Service/Realtime/RealtimeExtraParams";
import type { RealtimePoint } from "../../Service/Realtime/RealtimePoint";
import type { RtcSessionConnection } from "../../Service/Realtime/RealtimeSessionConnection";
import type { RealtimeVideoFormat } from "../../Service/Realtime/RealtimeVideoFormat";
import type { RoomEventTargetSize } from "./RoomEvent";

/**
 * Receives room-level business messages.
 */
export interface RoomListener {

  /**
   * Receives a complete message after fragment reassembly and recipient filtering.
   */
  onRoomMessage(
    senderUserID: string,
    message: Record<string, unknown>
  ): void;
}

/**
 * Defines RTC room membership and generation signaling.
 */
export interface RoomControlling {

  /**
   * Joins an RTC room while checking that the connection operation remains active.
   *
   * @param connection - RTC credentials returned by the session service.
   * @param ensureActive - Throws when the connection operation is no longer current.
   * @param measureRtcJoin - Starts join timing and returns a callback to complete it on success.
   * @throws Rejects if a previous room is still active, the operation is obsolete, or joining fails.
   */
  join(
    connection: RtcSessionConnection,
    ensureActive: () => void,
    measureRtcJoin?: () => () => void,
  ): Promise<void>;

  /**
   * Stops room heartbeats and leaves the current RTC room.
   */
  leave(): Promise<void>;

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
  ): Promise<void>;

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
  ): Promise<void>;

  /**
   * Updates the returned video dimensions.
   *
   * @param options.ensureActive - Checks that the configuration operation is current before sending.
   * @throws Rejects if the operation is canceled, the room is not ready, or sending fails.
   */
  changeTargetSize(
    options: {
      taskID: string;
      targetSize: RoomEventTargetSize;
      ensureActive: () => void;
    }
  ): Promise<void>;

  /**
   * Attempts to stop generation; ignores calls without a joined room or task identifier.
   */
  stopGeneration(
    taskID: string
  ): Promise<void>;

  /**
   * Sends interaction points; ignores an empty task identifier or point list.
   */
  sendTracks(
    taskID: string,
    points: RealtimePoint[]
  ): Promise<void>;

  /**
   * Sets the room message listener; an undefined value clears it.
   */
  setListener(
    listener?: RoomListener
  ): void;

  /**
   * Reassembles RTC messages, filters their recipients, and delivers complete messages.
   *
   * Called by the transport component that owns the RTC event listener.
   */
  handleIncomingMessage(
    senderUserID: string,
    rawMessage: string
  ): void;
}
