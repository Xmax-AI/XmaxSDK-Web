//
//  TrajectoryBinding.ts
//  XmaxSDK
//
//  Author: 翁跃庭 (Yueting Weng)
//  GitHub: https://github.com/Xmax-AI/XmaxSDK-Web
//
//  Copyright (c) 2026 XMAX.AI PTE. LTD.
//

import type { InteractionFrame } from "../../Media/Interaction/InteractionFrame";
import type { RealtimeVideoFormat } from "../../Service/Realtime/RealtimeVideoFormat";
import type { TrajectoryOverlayView } from "./TrajectoryOverlayView";

/**
 * A remote track's interaction binding, sharing format and task availability without owning a task ID.
 */
export class TrajectoryBinding {

  /**
   * The view currently owning this interaction binding.
   */
  private overlay?: TrajectoryOverlayView;

  /**
   * Whether interaction samples may be submitted.
   */
  private enabled = false;

  /**
   * Whether the binding still belongs to a valid track.
   */
  private valid = true;

  /**
   * Creates a binding with a sample listener and model-input format.
   */
  constructor(
    private readonly listener: (
      frame: InteractionFrame
    ) => void,
    private format: RealtimeVideoFormat
  ) { }

  /**
   * Attaches one interaction view, cancelling the previous owner's pointers when ownership changes.
   */
  attach(
    overlay: TrajectoryOverlayView
  ): void {
    if (!this.valid) {
      return;
    }
    if (this.overlay !== overlay) {
      this.overlay?.setBinding(undefined);
    }
    this.overlay = overlay;
    overlay.setBinding(
      this,
      this.format,
      this.enabled
    );
  }

  /**
   * Detaches only the current owner so stale detach callbacks cannot affect a replacement.
   */
  detach(
    overlay: TrajectoryOverlayView
  ): void {
    if (this.overlay === overlay) {
      this.overlay = undefined;
      overlay.setBinding(undefined);
    }
  }

  /**
   * Updates task interaction availability or format and cancels obsolete gestures.
   */
  update(
    enabled: boolean,
    format = this.format
  ): void {
    this.enabled = enabled;
    this.format = format;
    this.overlay?.setBinding(
      this,
      format,
      enabled
    );
  }

  /**
   * Forwards current-view samples unless disabled or invalidated.
   */
  submit(
    frame: InteractionFrame
  ): void {
    if (this.valid && this.enabled) {
      this.listener(frame);
    }
  }

  /**
   * Invalidates the binding and releases view interaction, preventing old references from reattaching.
   */
  invalidate(): void {
    this.valid = false;
    this.overlay?.setBinding(undefined);
    this.overlay = undefined;
  }
}
