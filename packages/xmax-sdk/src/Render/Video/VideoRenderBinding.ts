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

