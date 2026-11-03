//
//  RenderController.ts
//  XmaxSDK
//
//  Author: 翁跃庭 (Yueting Weng)
//  GitHub: https://github.com/Xmax-AI/XmaxSDK-Web
//
//  Copyright (c) 2026 XMAX.AI PTE. LTD.
//

import type { RemoteMediaTracks } from "../Foundation/Media/RemoteMediaTracks";
import type { RealtimeVideoBeautyOptions, RealtimeVideoBeautyErrorListener } from "../Service/Realtime/RealtimeVideoBeautyOptions";
import { RemoteVideoOutputController } from "./Video/RemoteVideoOutputController";
import type { InteractionFrame } from "../Media/Interaction/InteractionFrame";
import type { RealtimeVideoTrack } from "../Service/Realtime/RealtimeVideoTrack";
import type { RealtimeVideoFormat } from "../Service/Realtime/RealtimeVideoFormat";
import { type VideoRenderTarget } from "./Video/VideoRenderBinding";
import { VideoRenderRegistry } from "./Video/VideoRenderRegistry";
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
   * The remote track's attached presentation targets.
   */
  private readonly targets = new Set<VideoRenderTarget>();

  /**
   * Whether the current task permits interaction.
   */
  private interactionEnabled = false;

  /**
   * Whether the current remote view has completed render warmup.
   */
  private ready = false;

  /**
   * The shared result track used by presentation and public media output.
   */
  private outputTrack?: MediaStreamTrack;

  /**
   * The lazy shared result processing owner.
   */
  private readonly output = new RemoteVideoOutputController(track => {
    this.outputTrack = track;
    const stream = track && this.targets.size ? new MediaStream([track]) : null;
    for (const target of this.targets) {
      if (stream) {
        target.setMediaStream(
          stream,
          true
        );
      } else {
        target.setMediaStream(null);
      }
    }
  });

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
    this.targets.forEach(target => target.prepareForGeneration?.());
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
    this.output.setVideoTrack(track.mediaStreamTrack);
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
          if (this.targets.size === 0) {
            this.ready = false;
          }
          // Do not mirror generated results again; the view may still apply app-requested display mirroring.
          view.isMirrored = false;
          this.targets.add(view);
          view.setMediaStream(this.outputTrack ? new MediaStream([this.outputTrack]) : null);
        },
        detachHandler: view => {
          this.targets.delete(view);
          if (this.targets.size === 0) {
            this.ready = false;
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
    const previous = this.outputTrack;
    this.ready = false;
    if (this.track) {
      TrajectoryRegistry.binding(this.track)?.update(!!track && this.interactionEnabled);
    }
    this.output.setVideoTrack(track ?? undefined);
    if (!track && !previous) {
      this.targets.forEach(target => target.setMediaStream(null));
    }
  }

  /**
   * Supplies original RTC metadata to shared result processing.
   */
  setRemoteMediaTracks(
    tracks?: RemoteMediaTracks
  ): void {
    this.output.setSource(tracks);
  }

  /**
   * Observes the shared result tracks independently of attached views.
   */
  setRemoteMediaTracksListener(
    listener?: (
      tracks?: RemoteMediaTracks
    ) => void
  ): void {
    this.output.setListener(listener);
  }

  /**
   * Configures result beauty once for preview, recording tracks, and decoded-frame observers.
   */
  setRemoteVideoBeauty(
    options?: RealtimeVideoBeautyOptions
  ): Promise<void> {
    return this.output.setBeauty(options);
  }

  /**
   * Observes recoverable runtime beauty failures.
   */
  setRemoteVideoBeautyErrorListener(
    listener?: RealtimeVideoBeautyErrorListener
  ): void {
    this.output.setBeautyErrorListener(listener);
  }

  /**
   * Resets result processing configuration and owned resources when the manager closes.
   */
  closeBeauty(): Promise<void> {
    return this.output.close();
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
    this.output.setVideoTrack(undefined);
    const track = this.track;
    this.track = undefined;
    this.interactionEnabled = false;
    if (track) {
      TrajectoryRegistry.unregister(track);
      VideoRenderRegistry.unregister(track);
    }
    this.targets.forEach(target => target.setMediaStream(null));
    this.targets.clear();
  }
}
