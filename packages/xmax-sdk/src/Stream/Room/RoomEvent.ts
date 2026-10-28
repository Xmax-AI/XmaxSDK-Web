//
//  RoomEvent.ts
//  XmaxSDK
//
//  Author: 翁跃庭 (Yueting Weng)
//  GitHub: https://github.com/Xmax-AI/XmaxSDK-Web
//
//  Copyright (c) 2026 XMAX.AI PTE. LTD.
//

import { XmaxError, XmaxErrorCode } from "../../Foundation/Errors/XmaxError";
import { RuntimeInfo } from "../../Foundation/Runtime/RuntimeInfo";
import type { RealtimeContext } from "../../Service/Realtime/RealtimeContext";
import type { RealtimeExtraParams } from "../../Service/Realtime/RealtimeExtraParams";
import type { RealtimePoint } from "../../Service/Realtime/RealtimePoint";
import type { RealtimeVideoFormat } from "../../Service/Realtime/RealtimeVideoFormat";

/**
 * Integer pixel dimensions for generated or returned video.
 */
export interface RoomEventTargetSize {

  /**
   * The video width, in pixels.
   */
  width: number;

  /**
   * The video height, in pixels.
   */
  height: number;
}

/**
 * Shared parameters for generation-condition messages.
 */
export interface RoomEventGenerationOptions {

  /**
   * The application user identifier.
   */
  userID: string;

  /**
   * The current generation task identifier.
   */
  taskID: string;

  /**
   * The generation video format.
   */
  videoFormat: RealtimeVideoFormat;

  /**
   * The current generation conditions.
   */
  context: RealtimeContext;

  /**
   * The returned video dimensions, omitted when unset.
   */
  targetSize?: RoomEventTargetSize;

  /**
   * Whether to restore the original face; defaults to false.
   */
  faceRestoration?: boolean;

  /**
   * Whether the server preserves the media aspect ratio and pads the generation canvas.
   */
  paddingContain?: boolean;

  /**
   * Parameters merged into this message without being retained.
   */
  extraParams?: RealtimeExtraParams;
}

/**
 * Builds structured messages exchanged with the RTC room.
 *
 * Control messages include runtime information; trajectory snapshots contain interaction fields only.
 * Encoding failures throw internalError.
 */
export class RoomEvent {

  /**
   * Encodes a generation-start message.
   *
   * @param options.userID - The application user identifier.
   * @param options.taskID - The generation task identifier.
   * @param options.videoFormat - The generation video format.
   * @param options.context - The generation conditions.
   * @param options.targetSize - The returned video dimensions, omitted when unset.
   * @param options.minimumBitrate - The minimum returned bitrate, in kbps.
   * @param options.maximumBitrate - The maximum returned bitrate, in kbps.
   * @param options.mirror - Whether the server mirrors the input; defaults to false.
   * @param options.faceRestoration - Whether to restore the original face; defaults to false.
   * @param options.extraParams - Validated extensions merged into params.
   * @returns The serialized start message.
   */
  static start(
    options: {
      userID: string;
      taskID: string;
      videoFormat: RealtimeVideoFormat;
      context: RealtimeContext;
      targetSize?: RoomEventTargetSize;
      minimumBitrate: number;
      maximumBitrate: number;
      mirror?: boolean;
      faceRestoration?: boolean;
      paddingContain?: boolean;
      extraParams?: RealtimeExtraParams;
    }
  ): string {
    return RoomEvent.encode({
      event: "start",
      params: {
        ...RoomEvent.generationParameters(options),
        min_bitrate: options.minimumBitrate,
        max_bitrate: options.maximumBitrate,
        mirror: options.mirror ?? false,
      },
      user_id: options.userID,
      uid: options.taskID,
    });
  }

  /**
   * Encodes updated generation conditions.
   *
   * @param options.userID - The application user identifier.
   * @param options.taskID - The generation task identifier.
   * @param options.videoFormat - The generation video format.
   * @param options.context - The generation conditions.
   * @param options.targetSize - The returned video dimensions, omitted when unset.
   * @param options.faceRestoration - Whether to restore the original face; defaults to false.
   * @param options.extraParams - Validated extensions merged into params.
   * @returns The serialized change_condition message.
   */
  static changeCondition(
    options: RoomEventGenerationOptions
  ): string {
    return RoomEvent.encode({
      event: "change_condition",
      params: RoomEvent.generationParameters(options),
      user_id: options.userID,
      uid: options.taskID,
    });
  }

  /**
   * Encodes an update to returned dimensions and the bitrate range, in kbps.
   */
  static changeTargetSize(
    options: {
      userID: string;
      taskID: string;
      targetSize: RoomEventTargetSize;
      minimumBitrate: number;
      maximumBitrate: number;
    }
  ): string {
    return RoomEvent.encode({
      event: "change_target_size",
      params: {
        min_bitrate: options.minimumBitrate,
        max_bitrate: options.maximumBitrate,
        target_size: [
          Math.round(options.targetSize.width),
          Math.round(options.targetSize.height),
        ],
      },
      user_id: options.userID,
      uid: options.taskID,
    });
  }

  /**
   * Encodes a generation-stop message.
   */
  static stop(
    options: {
      userID: string;
      taskID: string
    }
  ): string {
    return RoomEvent.encode({
      event: "stop",
      user_id: options.userID,
      uid: options.taskID,
    });
  }

  /**
   * Encodes an interaction trajectory message.
   */
  static tracks(
    options: {
      userID: string;
      taskID: string;
      points: RealtimePoint[];
    }
  ): string {
    return RoomEvent.encode(
      {
        event: "tracks",
        tracks: options.points.map((point) => [point.x, point.y]),
        user_id: options.userID,
        uid: options.taskID,
      },
      false
    );
  }

  /**
   * Encodes a room heartbeat.
   */
  static heartbeat(
    options: {
      userID: string
    }
  ): string {
    return RoomEvent.encode({
      event: "heartbeat",
      user_id: options.userID,
    });
  }

  /**
   * Builds shared generation parameters, including face restoration and message extensions.
   *
   * @param options - The generation message parameters.
   * @returns The params shared by start and change_condition messages.
   */
  private static generationParameters(
    options: RoomEventGenerationOptions,
  ): Record<string, unknown> {
    return {
      model: "default",
      face_replace: options.faceRestoration ?? false,
      size: [options.videoFormat.width, options.videoFormat.height],
      ...(options.paddingContain && { padding: "contain" }),
      target_size: options.targetSize
        ? [
          Math.round(options.targetSize.width),
          Math.round(options.targetSize.height),
        ]
        : undefined,
      prompt: options.context.prompt,
      ref_image_path: options.context.referencePath,
      ...options.extraParams,
    };
  }

  /**
   * Serializes business fields, omitting repeated runtime information from frequent trajectory
   * snapshots.
   */
  private static encode(
    payload: Record<string, unknown>,
    includeRuntime = true,
  ): string {
    try {
      return JSON.stringify(includeRuntime ? {
        ...payload,
        runtime: RuntimeInfo.toJSON()
      } : payload);
    } catch {
      throw new XmaxError(
        XmaxErrorCode.internalError,
        "Failed to encode RTC room event",
      );
    }
  }
}
