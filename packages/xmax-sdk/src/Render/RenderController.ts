//
//  RenderController.ts
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
import { VideoRenderRegistry, type VideoRenderTarget } from "../Service/Realtime/VideoRenderBinding";
import type { RenderControlling } from "./RenderControlling";
import { TrajectoryBinding } from "./Trajectory/TrajectoryBinding";
import { TrajectoryRegistry } from "./Trajectory/TrajectoryRegistry";

/**
 * Owns remote-track presentation, readiness, and interaction bindings without managing generation tasks.
 */
export class RenderController implements RenderControlling {

  /**
   * The active remote track.
   */
  private track?: RealtimeVideoTrack;

  /**
   * The remote track's current rendering target.
   */
  private target?: VideoRenderTarget;

  /**
   * Whether the current task permits interaction.
   */
  private interactionEnabled = false;

  /**
   * Whether the current remote view has completed render warmup.
   */
  private ready = false;

  /**
   * Creates a controller with presentation lifecycle callbacks, without owning Core objects.
   */
  constructor(
    private readonly callbacks: {
      onFrameDisplayed?: () => void;
      onRenderWarmupCompleted?: () => void;
    } = {}
  ) { }

  /**
   * Whether the remote view has completed render warmup.
   */
  get isReady(): boolean {
    return this.ready;
  }

  /**
   * Resets first-frame and warmup readiness for a new task.
   */
  prepareForGeneration(): void {
    this.ready = false;
    this.target?.prepareForGeneration?.();
  }

  /**
   * Registers a remote track and invalidates its predecessor; local tracks use separate bindings.
   */
  registerRemoteTrack(
    track: RealtimeVideoTrack,
    listener: (
      frame: InteractionFrame
    ) => void
  ): void {
    this.resetRemoteTrack();
    this.track = track;
    if (track.videoFormat) {
      TrajectoryRegistry.register(
        track,
        new TrajectoryBinding(
          listener,
          track.videoFormat
        )
      );
    }

    VideoRenderRegistry.register(
      track,
      {
        // Continue playback for 750 ms after the first frame before beginning fade-in.
        renderWarmupMs: 750,
        renderWarmupCompletedHandler: () => {
          if (this.track === track) {
            this.ready = true;
            this.callbacks.onRenderWarmupCompleted?.();
          }
        },
        frameDisplayHandler: () => {
          if (this.track === track) {
            this.callbacks.onFrameDisplayed?.();
          }
        },
        attachHandler: view => {
          if (this.track !== track) {
            return;
          }
          this.ready = false;
          // Do not mirror generated results again; the view may still apply app-requested display mirroring.
          view.isMirrored = false;
          this.target = view;
          view.setMediaStream(track.mediaStreamTrack ? new MediaStream([track.mediaStreamTrack]) : null);
        },
        detachHandler: view => {
          if (this.target === view) {
            this.ready = false;
            this.target = undefined;
          }
          view.setMediaStream(null);
        },
      }
    );
  }

  /**
   * Updates remote media and disables interaction when presentation is cleared.
   */
  setRemoteMedia(
    track: MediaStreamTrack | null
  ): void {
    this.ready = false;
    if (this.track) {
      TrajectoryRegistry.binding(this.track)?.update(!!track && this.interactionEnabled);
    }
    this.target?.setMediaStream(track ? new MediaStream([track]) : null);
  }

  /**
   * Updates the interaction format and availability.
   */
  setInteractionEnabled(
    enabled: boolean,
    format?: RealtimeVideoFormat
  ): void {
    this.interactionEnabled = enabled;
    if (this.track) {
      TrajectoryRegistry.binding(this.track)?.update(
        enabled,
        format
      );
    }
  }

  /**
   * Invalidates capabilities before clearing presentation so stale frames or gestures cannot restore
   * ended tasks.
   */
  resetRemoteTrack(): void {
    this.ready = false;
    const track = this.track;
    this.track = undefined;
    this.interactionEnabled = false;
    if (track) {
      TrajectoryRegistry.unregister(track);
      VideoRenderRegistry.unregister(track);
    }
    this.target?.setMediaStream(null);
    this.target = undefined;
  }
}
