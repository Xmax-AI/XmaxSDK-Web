//
//  RenderControlling.ts
//  XmaxSDK
//
//  Author: 翁跃庭 (Yueting Weng)
//  GitHub: https://github.com/Xmax-AI/XmaxSDK-Web
//
//  Copyright (c) 2026 XMAX.AI PTE. LTD.
//

import type { InteractionFrame } from "../Media/Interaction/InteractionFrame";
import type { RealtimeVideoTrack } from "../Service/Realtime/RealtimeVideoTrack";
import type { RealtimeVideoFormat } from "../Service/Realtime/RealtimeVideoFormat";

/**
 * The render-layer boundary, hiding views, registries, and trajectory bindings from Core.
 */
export interface RenderControlling {

  /**
   * Whether remote render warmup has completed.
   */
  readonly isReady: boolean;

  /**
   * Resets presentation readiness so a bound view awaits the new task's first frame and warmup.
   */
  prepareForGeneration(): void;

  /**
   * Registers remote presentation and interaction, initially unavailable until the task starts.
   */
  registerRemoteTrack(
    track: RealtimeVideoTrack,
    listener: (
      frame: InteractionFrame
    ) => void
  ): void;

  /**
   * Updates remote media; null clears presentation without destroying the SDK track.
   */
  setRemoteMedia(
    track: MediaStreamTrack | null
  ): void;

  /**
   * Changes task interaction using input-media dimensions, not downlink dimensions.
   */
  setInteractionEnabled(
    enabled: boolean,
    format?: RealtimeVideoFormat
  ): void;

  /**
   * Unregisters remote capabilities and releases view resources while retaining local preview.
   */
  resetRemoteTrack(): void;
}
