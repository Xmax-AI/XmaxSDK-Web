//
//  InteractionController.ts
//  XmaxSDK
//
//  Author: 翁跃庭 (Yueting Weng)
//  GitHub: https://github.com/Xmax-AI/XmaxSDK-Web
//
//  Copyright (c) 2026 XMAX.AI PTE. LTD.
//

import { XmaxLogger } from "../../Foundation/Logging/XmaxLogger";
import type { RealtimePoint } from "../../Service/Realtime/RealtimePoint";
import type { RealtimeVideoFormat } from "../../Service/Realtime/RealtimeVideoFormat";
import { InteractionCoordinateMapper } from "./InteractionCoordinateMapper";
import type { InteractionFrame } from "./InteractionFrame";
import type { InteractionControlling, InteractionListener } from "./InteractionControlling";

/**
 * Maps viewport samples to media coordinates and submits them serially, retaining only the latest
 * pending sample.
 */
export class InteractionController implements InteractionControlling {

  /**
   * The active task and fixed format, identified by object identity across task replacement.
   */
  private active?: {
    taskID: string;
    videoFormat: RealtimeVideoFormat;
    coordinateSpace: "normalized" | "pixels";
  };

  /**
   * The latest interaction sample retained while sending is busy.
   */
  private pending?: {
    context: NonNullable<InteractionController["active"]>;
    points: RealtimePoint[]
  };

  /**
   * The interaction context whose samples are currently being drained.
   */
  private draining?: NonNullable<InteractionController["active"]>;

  /**
   * Creates an interaction controller with a sender, without owning a room or RTC adapter.
   */
  constructor(
    private readonly listener: InteractionListener
  ) { }

  /**
   * Activates a task or updates its input format, discarding obsolete samples.
   */
  startInteraction(
    taskID: string,
    videoFormat: RealtimeVideoFormat,
    coordinateSpace: "normalized" | "pixels" = "normalized",
  ): void {
    this.stopInteraction();
    if (taskID) {
      this.active = {
        taskID,
        videoFormat,
        coordinateSpace
      };
    }
  }

  /**
   * Invalidates interaction immediately; messages already submitted to RTC cannot be recalled.
   */
  stopInteraction(): void {
    this.active = undefined;
    this.pending = undefined;
    this.draining = undefined;
  }

  /**
   * Maps points synchronously and replaces pending samples to avoid constrained-network backlogs.
   */
  submitInteraction(
    frame: InteractionFrame
  ): void {
    const context = this.active;
    if (!context) {
      return;
    }

    const points = frame.points.flatMap(point => {
      const mapped = InteractionCoordinateMapper.map(
        point,
        frame,
        context.videoFormat,
        context.coordinateSpace
      );
      return mapped ? [mapped] : [];
    });
    if (!points.length) {
      return;
    }

    this.pending = {
      context,
      points
    };
    if (this.draining !== context) {
      void this.drain(context);
    }
  }

  /**
   * Sends samples in order; a failed sample does not stop generation or subsequent interaction.
   */
  private async drain(
    context: NonNullable<InteractionController["active"]>
  ): Promise<void> {
    this.draining = context;
    try {
      while (this.active === context && this.pending?.context === context) {
        const { points } = this.pending;
        this.pending = undefined;
        try {
          await this.listener(
            context.taskID,
            points
          );
        } catch {
          if (context === this.active) {
            XmaxLogger.interaction.warning(() => "发送交互轨迹失败，已丢弃当前采样帧 (Interaction Sample Dropped)");
          }
        }
      }
    } finally {
      if (this.draining === context) {
        this.draining = undefined;
      }
    }
  }
}
