//
//  VideoRenderBinding.ts
//  XmaxSDK
//
//  Author: 翁跃庭 (Yueting Weng)
//  GitHub: https://github.com/Xmax-AI/XmaxSDK-Web
//
//  Copyright (c) 2026 XMAX.AI PTE. LTD.
//

import type { VideoContentMode } from "../../Foundation/Media/Video/VideoContentMode";
import type { RealtimeVideoTrack } from "./RealtimeVideoTrack";

/**
 * A track rendering target implemented by a view.
 *
 * The binding delivers media and mirroring settings through this contract without depending on a
 * concrete view type.
 */
export interface VideoRenderTarget {

  /**
   * Restarts first-frame and render-warmup waiting for a new task without recreating the stream.
   */
  prepareForGeneration?: () => void;

  /**
   * The view's internal player, if exposed by the target.
   */
  readonly videoElement?: HTMLVideoElement;

  /**
   * Whether to mirror the displayed image, without affecting published media.
   */
  isMirrored: boolean;

  /**
   * Sets the rendered media stream; null clears the image.
   */
  setMediaStream: (
    stream: MediaStream | null
  ) => void;
}

/**
 * The binding behavior between a video track and a rendering view.
 */
export interface VideoRenderBinding {

  /**
   * The remote presentation warmup after the first frame; unset for local preview.
   */
  renderWarmupMs?: number;

  /**
   * Notifies the track owner when warmup ends and fade-in begins.
   */
  renderWarmupCompletedHandler?: () => void;

  /**
   * Notifies the track owner of the first presented frame, independently of the view's fade-in callback.
   */
  frameDisplayHandler?: () => void;

  /**
   * Attaches the track's media when a view binds to it.
   */
  attachHandler: (
    target: VideoRenderTarget,
    contentMode: VideoContentMode
  ) => void;

  /**
   * Releases presentation resources when a view unbinds from the track.
   */
  detachHandler: (
    target: VideoRenderTarget
  ) => void;
}

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
