//
//  XmaxRealtimeDualVideoView.ts
//  XmaxSDK
//
//  Author: 翁跃庭 (Yueting Weng)
//  GitHub: https://github.com/Xmax-AI/XmaxSDK-Web
//
//  Copyright (c) 2026 XMAX.AI PTE. LTD.
//

import { VideoContentMode } from "../../Foundation/Media/Video/VideoContentMode";
import type { RealtimeVideoTrack } from "../../Service/Realtime/RealtimeVideoTrack";
import { XmaxRealtimeVideoView } from "./XmaxRealtimeVideoView";
import { VideoRenderRegistry } from "../../Service/Realtime/VideoRenderBinding";
import type { TrajectoryEffectRendering } from "../Trajectory/TrajectoryEffectRendering";

/**
 * A framework-independent view switching between local preview and remote generated video.
 *
 * SDK remote tracks fade in after first-frame readiness and render warmup. Clearing the remote track
 * immediately restores local preview.
 */
export class XmaxRealtimeDualVideoView {

  /**
   * The view's root element.
   */
  readonly element: HTMLDivElement;

  /**
   * The local-preview video view.
   */
  private readonly localVideoView: XmaxRealtimeVideoView;

  /**
   * The remote generated-video view.
   */
  private readonly remoteVideoView: XmaxRealtimeVideoView;

  /**
   * The currently bound local track.
   */
  private currentLocalTrack?: RealtimeVideoTrack;

  /**
   * The currently bound remote track.
   */
  private currentRemoteTrack?: RealtimeVideoTrack;

  /**
   * The shared scaling and cropping mode.
   */
  private contentMode: VideoContentMode;

  /**
   * The remote fade-in duration, in seconds.
   */
  private fadeInDuration = 0.3;

  /**
   * Creates a dual-track realtime video view.
   *
   * @param options.localTrack - The local preview track.
   * @param options.remoteTrack - The generated track displayed over preview.
   * @param options.videoContentMode - The layout mode for both tracks; defaults to fill.
   * @param options.remoteVideoFadeInDuration - Fade duration in seconds; defaults to 0.3. Nonpositive or
   * nonfinite values disable animation.
   */
  constructor(
    options?: {
      localTrack?: RealtimeVideoTrack;
      remoteTrack?: RealtimeVideoTrack;
      videoContentMode?: VideoContentMode;
      remoteVideoFadeInDuration?: number;
      isInteractionEnabled?: boolean;
    }
  ) {
    this.contentMode = options?.videoContentMode ?? VideoContentMode.fill;
    this.currentLocalTrack = options?.localTrack;
    this.currentRemoteTrack = options?.remoteTrack;

    this.element = document.createElement("div");
    this.element.style.position = "relative";
    this.element.style.overflow = "hidden";
    this.element.style.backgroundColor = "black";

    this.localVideoView = new XmaxRealtimeVideoView({
      videoContentMode: this.contentMode,
      isInteractionEnabled: false
    });
    this.remoteVideoView = new XmaxRealtimeVideoView({
      videoContentMode: this.contentMode,
      isInteractionEnabled: options?.isInteractionEnabled
    });
    this.remoteVideoFadeInDuration = options?.remoteVideoFadeInDuration ?? 0.3;
    for (const view of [this.localVideoView, this.remoteVideoView]) {
      view.element.style.position = "absolute";
      view.element.style.inset = "0";
      this.element.appendChild(view.element);
    }

    this.localVideoView.track = this.currentLocalTrack;
    this.updateRemoteTrack();
  }

  /**
   * The remote fade-in duration, in seconds; defaults to 0.3.
   */
  get remoteVideoFadeInDuration(): number {
    return this.fadeInDuration;
  }

  /**
   * Sets the next fade duration, disabling animation for nonpositive or nonfinite values without
   * skipping first-frame or warmup waits.
   */
  set remoteVideoFadeInDuration(
    duration: number
  ) {
    this.fadeInDuration = duration;
    const milliseconds = Number.isFinite(duration) && duration > 0 ? duration * 1000 : 0;
    this.remoteVideoView.fadeInDurationMs = Number.isFinite(milliseconds) ? milliseconds : 0;
  }

  /**
   * The displayed local track.
   */
  get localTrack(): RealtimeVideoTrack | undefined {
    return this.currentLocalTrack;
  }

  /**
   * Whether remote trajectory interaction is enabled; local preview never captures gestures.
   */
  get isInteractionEnabled(): boolean {
    return this.remoteVideoView.isInteractionEnabled;
  }

  /**
   * Updates the remote view's interaction preference.
   */
  set isInteractionEnabled(
    enabled: boolean
  ) {
    this.remoteVideoView.isInteractionEnabled = enabled;
  }

  /**
   * The remote view's custom trajectory effect.
   */
  get trajectoryRenderer(): TrajectoryEffectRendering | undefined {
    return this.remoteVideoView.trajectoryRenderer;
  }

  /**
   * Sets the remote effect; undefined restores the default without changing trajectory transmission.
   */
  set trajectoryRenderer(
    renderer: TrajectoryEffectRendering | undefined
  ) {
    this.remoteVideoView.trajectoryRenderer = renderer;
  }

  /**
   * Replaces local preview, retaining its binding when the track is unchanged.
   */
  set localTrack(
    track: RealtimeVideoTrack | undefined
  ) {
    if (this.currentLocalTrack === track) {
      return;
    }
    this.currentLocalTrack = track;
    this.localVideoView.track = track;
  }

  /**
   * The generated remote track, shown after first-frame readiness and warmup. Clearing it restores local
   * preview.
   */
  get remoteTrack(): RealtimeVideoTrack | undefined {
    return this.currentRemoteTrack;
  }

  /**
   * Replaces the remote track and restarts first-frame presentation, or restores preview when cleared.
   */
  set remoteTrack(
    track: RealtimeVideoTrack | undefined
  ) {
    if (this.currentRemoteTrack === track) {
      return;
    }
    this.currentRemoteTrack = track;
    this.updateRemoteTrack();
  }

  /**
   * The video layout mode.
   */
  get videoContentMode(): VideoContentMode {
    return this.contentMode;
  }

  /**
   * Updates scaling and cropping for both local and remote views.
   */
  set videoContentMode(
    mode: VideoContentMode
  ) {
    if (this.contentMode === mode) {
      return;
    }
    this.contentMode = mode;
    this.localVideoView.videoContentMode = mode;
    this.remoteVideoView.videoContentMode = mode;
  }

  /**
   * Whether local preview is mirrored.
   */
  get isLocalMirrored(): boolean {
    return this.localVideoView.isMirrored;
  }

  /**
   * Changes local-preview mirroring without modifying capture pixels or remote video.
   */
  set isLocalMirrored(
    mirrored: boolean
  ) {
    this.localVideoView.isMirrored = mirrored;
  }

  /**
   * Attaches the view to a container.
   */
  attach(
    to: HTMLElement
  ): void {
    to.appendChild(this.element);
    this.localVideoView.attach(this.element);
    this.remoteVideoView.attach(this.element);
  }

  /**
   * Removes the view from its container.
   */
  detach(): void {
    this.localVideoView.detach();
    this.remoteVideoView.detach();
    this.element.remove();
  }

  /**
   * Updates remote binding, sharing SDK single-view warmup or waiting for an ordinary track's first
   * frame.
   */
  private updateRemoteTrack(): void {
    const remoteTrack = this.currentRemoteTrack;

    this.remoteVideoView.frameDisplayHandler = undefined;
    this.remoteVideoView.track = undefined;
    this.remoteVideoView.element.style.transition = "";
    this.remoteVideoView.element.style.opacity = "0";
    this.remoteVideoView.element.style.visibility = "hidden";
    this.remoteVideoView.element.style.backgroundColor = "black";

    if (!remoteTrack) {
      return;
    }

    // SDK tracks already own warmup and fade-in; do not layer another container animation over them.
    if (VideoRenderRegistry.binding(remoteTrack)?.renderWarmupMs !== undefined) {
      this.remoteVideoView.element.style.visibility = "visible";
      this.remoteVideoView.element.style.opacity = "1";
      this.remoteVideoView.element.style.backgroundColor = "transparent";
      this.remoteVideoView.track = remoteTrack;
      return;
    }

    this.remoteVideoView.frameDisplayHandler = () => {
      if (this.currentRemoteTrack !== remoteTrack) {
        return;
      }
      this.showRemoteVideo();
    };
    this.remoteVideoView.track = remoteTrack;
  }

  /**
   * Fades in remote video after its first frame is submitted.
   */
  private showRemoteVideo(): void {
    const element = this.remoteVideoView.element;
    if (element.style.visibility === "visible" && element.style.opacity === "1") {
      return;
    }

    element.style.visibility = "visible";
    const durationMs = this.remoteVideoView.fadeInDurationMs;
    const reduceMotion = globalThis.matchMedia?.("(prefers-reduced-motion: reduce)").matches;
    if (durationMs === 0 || reduceMotion) {
      element.style.transition = "none";
      element.style.opacity = "1";
      return;
    }
    element.style.transition = `opacity ${durationMs}ms ease-in-out`;

    // Wait for one animation frame so the opacity transition begins from the hidden state.
    requestAnimationFrame(() => {
      element.style.opacity = "1";
    });
  }
}
