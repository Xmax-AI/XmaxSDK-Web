//
//  TrajectoryOverlayView.ts
//  XmaxSDK
//
//  Author: 翁跃庭 (Yueting Weng)
//  GitHub: https://github.com/Xmax-AI/XmaxSDK-Web
//
//  Copyright (c) 2026 XMAX.AI PTE. LTD.
//

import { VideoContentMode } from "../../Foundation/Media/Video/VideoContentMode";
import { XmaxLogger } from "../../Foundation/Logging/XmaxLogger";
import { InteractionCoordinateMapper } from "../../Media/Interaction/InteractionCoordinateMapper";
import type { RealtimeVideoFormat } from "../../Service/Realtime/RealtimeVideoFormat";
import type { TrajectoryBinding } from "./TrajectoryBinding";
import type { TrajectoryEffectRendering } from "./TrajectoryEffectRendering";
import type { TrajectoryPoint } from "./TrajectoryPoint";

/**
 * Samples mouse, touch, and pen input, renders effects, and submits viewport snapshots at approximately
 * 30 Hz.
 */
export class TrajectoryOverlayView {

  /**
   * The transparent interaction-layer element.
   */
  readonly element = document.createElement("div");

  /**
   * The interaction binding supplied by the current track.
   */
  private binding?: TrajectoryBinding;

  /**
   * The fixed media format used for coordinate mapping.
   */
  private format?: RealtimeVideoFormat;

  /**
   * The image scaling and cropping mode.
   */
  private contentMode = VideoContentMode.fill;

  /**
   * Whether the displayed image is mirrored horizontally.
   */
  private mirrored = false;

  /**
   * Whether the app requests interaction.
   */
  private requested = true;

  /**
   * Whether the binding permits interaction samples.
   */
  private enabled = false;

  /**
   * The active pointers indexed by browser pointer ID.
   */
  private readonly pointers = new Map<number, TrajectoryPoint>();

  /**
   * The next trajectory ID.
   */
  private nextID = 0;

  /**
   * The pending animation-frame handle.
   */
  private animation?: number;

  /**
   * The monotonic time of the last submitted sample, in milliseconds.
   */
  private lastSample = 0;

  /**
   * The observer tracking interaction-viewport size.
   */
  private resizeObserver?: ResizeObserver;

  /**
   * The current viewport dimensions, in CSS pixels.
   */
  private viewport?: {
    width: number;
    height: number
  };

  /**
   * The handler cancelling gestures when the page becomes hidden.
   */
  private readonly visibilityChanged = () => {
    if (document.hidden) {
      this.cancel();
    }
    this.updateStyle();
  };

  /**
   * The handler beginning a pointer trajectory.
   */
  private readonly onDown = (event: PointerEvent) => this.begin(event);

  /**
   * The handler updating pointer position and visuals.
   */
  private readonly onMove = (event: PointerEvent) => this.move(event);

  /**
   * The handler ending a pointer trajectory.
   */
  private readonly onEnd = (event: PointerEvent) => this.end(event.pointerId);

  /**
   * Creates a transparent overlay with a separate effect renderer, capturing pointers only when
   * interaction is available.
   */
  constructor(
    private readonly renderer: TrajectoryEffectRendering
  ) {
    Object.assign(
      this.element.style,
      {
        position: "absolute",
        inset: "0",
        zIndex: "2",
        overflow: "hidden"
      }
    );
    Object.assign(
      renderer.element.style,
      {
        position: "absolute",
        inset: "0",
        width: "100%",
        height: "100%",
        pointerEvents: "none"
      }
    );
    this.element.appendChild(renderer.element);
    this.element.addEventListener(
      "pointerdown",
      this.onDown
    );
    this.element.addEventListener(
      "pointermove",
      this.onMove
    );
    this.element.addEventListener(
      "pointerup",
      this.onEnd
    );
    this.element.addEventListener(
      "pointercancel",
      this.onEnd
    );
    this.element.addEventListener(
      "lostpointercapture",
      this.onEnd
    );
    document.addEventListener(
      "visibilitychange",
      this.visibilityChanged
    );
    if (typeof ResizeObserver !== "undefined") {
      this.resizeObserver = new ResizeObserver(() => this.cancel());
      this.resizeObserver.observe(this.element);
    }
    this.updateStyle();
  }

  /**
   * Updates the task binding and clears obsolete gestures and samples.
   */
  setBinding(
    binding?: TrajectoryBinding,
    format?: RealtimeVideoFormat,
    enabled = false
  ): void {
    this.cancel();
    this.binding = binding;
    this.format = format;
    this.enabled = enabled;
    this.updateStyle();
  }

  /**
   * Updates presentation settings and stops submitting coordinates from the old layout.
   */
  configure(
    mode: VideoContentMode,
    mirrored: boolean,
    enabled: boolean
  ): void {
    if (this.contentMode !== mode || this.mirrored !== mirrored || this.requested !== enabled) {
      this.cancel();
    }
    this.contentMode = mode;
    this.mirrored = mirrored;
    this.requested = enabled;
    this.updateStyle();
  }

  /**
   * Releases sampling, animation, pointer capture, and listeners while allowing renderer reuse.
   */
  dispose(): void {
    this.binding?.detach(this);
    this.cancel();
    this.resizeObserver?.disconnect();
    document.removeEventListener(
      "visibilitychange",
      this.visibilityChanged
    );
    this.element.removeEventListener(
      "pointerdown",
      this.onDown
    );
    this.element.removeEventListener(
      "pointermove",
      this.onMove
    );
    this.element.removeEventListener(
      "pointerup",
      this.onEnd
    );
    this.element.removeEventListener(
      "pointercancel",
      this.onEnd
    );
    this.element.removeEventListener(
      "lostpointercapture",
      this.onEnd
    );
    this.element.remove();
  }

  /**
   * Allows page scrolling when no task is active or interaction is disabled.
   */
  private updateStyle(): void {
    const active = this.requested && this.enabled && !!this.binding && !document.hidden;
    this.element.style.pointerEvents = active ? "auto" : "none";
    this.element.style.touchAction = active ? "none" : "auto";
    this.element.style.userSelect = active ? "none" : "auto";
  }

  /**
   * Rejects letterbox margins and clamps out-of-viewport movement to visible video edges.
   */
  private point(
    event: PointerEvent,
    id: number,
    clamp: boolean
  ): TrajectoryPoint | undefined {
    const viewport = this.element.getBoundingClientRect();
    if (!this.format) {
      return undefined;
    }
    const rect = InteractionCoordinateMapper.displayedFrame(
      viewport,
      this.format,
      this.contentMode
    );
    if (!rect || !Number.isFinite(event.clientX) || !Number.isFinite(event.clientY)) {
      return undefined;
    }
    const minX = Math.max(0, rect.x);
    const minY = Math.max(0, rect.y);
    const maxX = Math.min(viewport.width, rect.x + rect.width);
    const maxY = Math.min(viewport.height, rect.y + rect.height);
    let x = event.clientX - viewport.left;
    let y = event.clientY - viewport.top;
    if (!clamp && (x < minX || x > maxX || y < minY || y > maxY)) {
      return undefined;
    }
    x = Math.max(minX, Math.min(maxX, x));
    y = Math.max(minY, Math.min(maxY, y));
    return Object.freeze({
      id,
      location: Object.freeze({
        x,
        y
      }),
      normalizedLocation: Object.freeze({
        x: (x - rect.x) / rect.width,
        y: (y - rect.y) / rect.height
      }),
      timestamp: performance.now(),
    });
  }

  /**
   * Samples presses immediately without waiting for the next interval, accepting only the primary mouse
   * button.
   */
  private begin(
    event: PointerEvent
  ): void {
    if (!this.requested || !this.enabled || !this.binding || document.hidden || event.button !== 0) {
      return;
    }
    const point = this.point(
      event,
      ++this.nextID,
      false
    );
    if (!point) {
      return;
    }
    event.preventDefault();
    this.pointers.set(
      event.pointerId,
      point
    );
    try {
      this.element.setPointerCapture(event.pointerId);
    } catch {
      // The browser may already have cancelled capture; pointercancel or disposal still ends the gesture.
    }
    this.render(() => this.renderer.renderBegan([point]));
    this.sample(
      performance.now(),
      true
    );
    this.schedule();
  }

  /**
   * Updates the latest position and visuals on high-frequency moves without sending each event.
   */
  private move(
    event: PointerEvent
  ): void {
    const previous = this.pointers.get(event.pointerId);
    if (!previous) {
      return;
    }
    const point = this.point(
      event,
      previous.id,
      true
    );
    if (point) {
      this.pointers.set(
        event.pointerId,
        point
      );
      this.render(() => this.renderer.renderMoved([point]));
    }
  }

  /**
   * Releases one pointer, continuing multi-touch interaction until the final pointer ends.
   */
  private end(
    pointerID: number
  ): void {
    const point = this.pointers.get(pointerID);
    if (!point) {
      return;
    }
    this.pointers.delete(pointerID);
    try {
      this.element.releasePointerCapture(pointerID);
    } catch {
      // The browser may already have released capture during pointerup or cancellation.
    }
    this.render(() => this.renderer.renderEnded([point.id]));
    if (!this.pointers.size) {
      this.stopSampling();
    }
  }

  /**
   * Cancels all gestures and visual effects without retaining cross-lifecycle trajectories.
   */
  private cancel(): void {
    for (const id of [...this.pointers.keys()]) {
      this.end(id);
    }
    this.stopSampling();
    this.render(() => this.renderer.reset());
  }

  /**
   * Clears the sampling callback and viewport snapshot.
   */
  private stopSampling(): void {
    if (this.animation !== undefined) {
      cancelAnimationFrame(this.animation);
    }
    this.animation = undefined;
    this.viewport = undefined;
    this.lastSample = 0;
  }

  /**
   * Runs the animation clock only while pointers are active.
   */
  private schedule(): void {
    if (this.animation === undefined && this.pointers.size) {
      this.animation = requestAnimationFrame(now => {
        this.animation = undefined;
        this.sample(now);
        this.schedule();
      });
    }
  }

  /**
   * Samples all active pointers at a fixed frequency, cancelling after layout changes rather than
   * sending obsolete coordinates.
   */
  private sample(
    now: number,
    force = false
  ): void {
    if (document.hidden) {
      this.cancel();
      return;
    }
    const { width, height } = this.element.getBoundingClientRect();
    if (this.viewport && (width !== this.viewport.width || height !== this.viewport.height)) {
      this.cancel();
      return;
    }
    this.viewport = {
      width,
      height
    };
    if (!force && now - this.lastSample < 1000 / 30) {
      return;
    }
    this.lastSample = now;
    this.binding?.submit({
      points: [...this.pointers.values()].map(point => point.location),
      viewportSize: this.viewport,
      contentMode: this.contentMode,
      mirrored: this.mirrored,
    });
  }

  /**
   * Isolates custom-renderer failures from sampling and message delivery.
   */
  private render(
    action: () => void
  ): void {
    try {
      action();
    } catch {
      XmaxLogger.render.warning(() => "轨迹效果绘制失败 (Trajectory Rendering Failed)");
    }
  }
}
