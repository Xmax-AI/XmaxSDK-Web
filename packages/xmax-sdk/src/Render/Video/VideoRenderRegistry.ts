//
//  VideoRenderRegistry.ts
//  XmaxSDK
//
//  Author: 翁跃庭 (Yueting Weng)
//  GitHub: https://github.com/Xmax-AI/XmaxSDK-Web
//
//  Copyright (c) 2026 XMAX.AI PTE. LTD.
//

import type { RealtimeVideoTrack } from "../../Service/Realtime/RealtimeVideoTrack";
import type { VideoRenderBinding } from "./VideoRenderBinding";

/**
 * A registry of custom track rendering bindings.
 *
 * Tracks needing custom rendering register a binding at creation. Unregistered tracks render directly
 * through mediaStreamTrack.
 */
export class VideoRenderRegistry {

  /**
   * Custom rendering bindings indexed by video track.
   */
  private static bindings = new WeakMap<RealtimeVideoTrack, VideoRenderBinding>();

  /**
   * Registers or replaces a track's custom rendering binding.
   *
   * @internal
   */
  static register(
    track: RealtimeVideoTrack,
    binding: VideoRenderBinding
  ): void {
    VideoRenderRegistry.bindings.set(
      track,
      binding
    );
  }

  /**
   * Removes a binding without detaching views or releasing their resources.
   *
   * @internal
   */
  static unregister(
    track: RealtimeVideoTrack
  ): void {
    VideoRenderRegistry.bindings.delete(track);
  }

  /**
   * Returns a track's custom rendering binding, or undefined when unregistered.
   *
   * @internal
   */
  static binding(
    forTrack: RealtimeVideoTrack
  ): VideoRenderBinding | undefined {
    return VideoRenderRegistry.bindings.get(forTrack);
  }
}

