//
//  InteractionControlling.ts
//  XmaxSDK
//
//  Author: 翁跃庭 (Yueting Weng)
//  GitHub: https://github.com/Xmax-AI/XmaxSDK-Web
//
//  Copyright (c) 2026 XMAX.AI PTE. LTD.
//

import type { RealtimePoint } from "../../Service/Realtime/RealtimePoint";
import type { RealtimeVideoFormat } from "../../Service/Realtime/RealtimeVideoFormat";
import type { InteractionFrame } from "./InteractionFrame";

/**
 * Submits task-relative media coordinates through the stream layer.
 */
export type InteractionListener = (
  taskID: string,
  points: RealtimePoint[]
) => Promise<void>;

/**
 * The generation-task interaction context and sampling capabilities.
 */
export interface InteractionControlling {

  /**
   * Activates a task or updates its input format, invalidating obsolete pending samples.
   */
  startInteraction(
    taskID: string,
    videoFormat: RealtimeVideoFormat
  ): void;

  /**
   * Disables interaction and drops pending samples.
   */
  stopInteraction(): void;

  /**
   * Submits a viewport sample, ignored without an active task.
   */
  submitInteraction(
    frame: InteractionFrame
  ): void;
}
