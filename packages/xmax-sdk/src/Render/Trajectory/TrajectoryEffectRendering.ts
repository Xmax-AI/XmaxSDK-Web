//
//  TrajectoryEffectRendering.ts
//  XmaxSDK
//
//  Author: 翁跃庭 (Yueting Weng)
//  GitHub: https://github.com/Xmax-AI/XmaxSDK-Web
//
//  Copyright (c) 2026 XMAX.AI PTE. LTD.
//

import type { TrajectoryID, TrajectoryPoint } from "./TrajectoryPoint";

/**
 * A replaceable trajectory effect, independent of sampling, coordinate mapping, and network
 * transmission. Use one instance per view. Reset must release animation and clear trajectory state.
 */
export interface TrajectoryEffectRendering {

  /**
   * The element installed in the interaction layer; the SDK disables its pointer events.
   */
  readonly element: HTMLElement;

  /**
   * Draws newly started trajectories.
   */
  renderBegan(
    points: readonly TrajectoryPoint[]
  ): void;

  /**
   * Updates existing trajectories.
   */
  renderMoved(
    points: readonly TrajectoryPoint[]
  ): void;

  /**
   * Ends trajectories, optionally retaining fade-out animation.
   */
  renderEnded(
    identifiers: readonly TrajectoryID[]
  ): void;

  /**
   * Clears trajectories and animation while permitting instance reuse.
   */
  reset(): void;
}
