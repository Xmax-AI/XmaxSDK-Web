//
//  TrajectoryRegistry.ts
//  XmaxSDK
//
//  Author: 翁跃庭 (Yueting Weng)
//  GitHub: https://github.com/Xmax-AI/XmaxSDK-Web
//
//  Copyright (c) 2026 XMAX.AI PTE. LTD.
//

import type { RealtimeVideoTrack } from "../../Service/Realtime/RealtimeVideoTrack";
import type { TrajectoryBinding } from "./TrajectoryBinding";

/**
 * Finds interaction bindings by track-object identity, not potentially duplicated track-ID strings.
 */
export class TrajectoryRegistry {

  /**
   * The interaction bindings indexed by media-track identity.
   */
  private static readonly bindings = new WeakMap<RealtimeVideoTrack, TrajectoryBinding>();

  /**
   * Invalidates an existing binding before replacing it.
   */
  static register(
    track: RealtimeVideoTrack,
    binding: TrajectoryBinding
  ): void {
    this.unregister(track);
    this.bindings.set(
      track,
      binding
    );
  }

  /**
   * Returns a track's interaction binding; local tracks do not register one.
   */
  static binding(
    track: RealtimeVideoTrack
  ): TrajectoryBinding | undefined {
    return this.bindings.get(track);
  }

  /**
   * Actively releases view resources rather than relying only on WeakMap collection.
   */
  static unregister(
    track: RealtimeVideoTrack
  ): void {
    this.bindings.get(track)?.invalidate();
    this.bindings.delete(track);
  }
}
