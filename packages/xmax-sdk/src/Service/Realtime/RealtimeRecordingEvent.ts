//
//  RealtimeRecordingEvent.ts
//  XmaxSDK
//
//  Author: 翁跃庭 (Yueting Weng)
//  GitHub: https://github.com/Xmax-AI/XmaxSDK-Web
//
//  Copyright (c) 2026 XMAX.AI PTE. LTD.
//

import type { XmaxError } from "../../Foundation/Errors/XmaxError";

/**
 * 单次录制的最终事件类型。
 */
export enum RealtimeRecordingEventType {

  /**
   * 达到录制时长上限并交付完整文件。
   */
  completed = "completed",

  /**
   * 录制提前结束，仍可交付已封装的文件。
   */
  interrupted = "interrupted",

  /**
   * 录制或文件封装失败，无法交付有效文件。
   */
  failed = "failed",
}

/**
 * 已完成文件封装的录制结束原因。
 */
export enum RealtimeRecordingFinishReason {

  /**
   * 达到本次录制的时长上限。
   */
  durationLimit = "durationLimit",

  /**
   * 当前生成任务结束。
   */
  generationEnded = "generationEnded",

  /**
   * 生成任务重启，结束旧任务的录制。
   */
  restarted = "restarted",

  /**
   * 远端媒体中断，提前结束录制。
   */
  mediaInterrupted = "mediaInterrupted",
}

/**
 * 已封装的录制文件；格式由 blob.type 指示，不保证为 MP4。
 */
export interface RealtimeRecordingResult {

  /**
   * 可供保存、上传或预览的完整文件；成功裁去长帧等待时，时长短于实际录制时间。
   */
  readonly blob: Blob;

  /**
   * 录制期间是否接入过未静音的远端音频轨；不表示内容一定有声音。
   */
  readonly hasAudio: boolean;

  /**
   * 录制结束原因。
   */
  readonly reason: RealtimeRecordingFinishReason;
}

/**
 * 录制终态；成功封装的提前结束返回 interrupted，无法提供有效文件返回 failed。
 */
export type RealtimeRecordingEvent =
  | {
    /**
     * 文件已封装完成，区分达到上限和提前结束。
     */
    type: RealtimeRecordingEventType.completed | RealtimeRecordingEventType.interrupted;
    /**
     * 本次录制所属的生成任务标识。
     */
    taskID: string;
    /**
     * 可供保存或预览的录制文件及结束原因。
     */
    result: RealtimeRecordingResult;
  }
  | {
    /**
     * 录制或封装失败，无法交付有效文件。
     */
    type: RealtimeRecordingEventType.failed;
    /**
     * 本次录制所属的生成任务标识。
     */
    taskID: string;
    /**
     * 录制失败原因，不影响当前实时生成任务。
     */
    error: XmaxError;
  };

/**
 * 每次录制交付一次最终事件，监听器异常不影响实时生成。
 */
export type RealtimeRecordingListener = (
  event: RealtimeRecordingEvent
) => void;
