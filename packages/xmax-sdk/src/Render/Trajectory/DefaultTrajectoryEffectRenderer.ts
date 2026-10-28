//
//  DefaultTrajectoryEffectRenderer.ts
//  XmaxSDK
//
//  Author: 翁跃庭 (Yueting Weng)
//  GitHub: https://github.com/Xmax-AI/XmaxSDK-Web
//
//  Copyright (c) 2026 XMAX.AI PTE. LTD.
//

import type { TrajectoryEffectRendering } from "./TrajectoryEffectRendering";
import type { TrajectoryID, TrajectoryPoint } from "./TrajectoryPoint";

/**
 * CSS-pixel dimensions for trajectory glow, stroke layers, and pointer decorations.
 */
const VISUAL = {
  outerWidth: 18,
  outerBlur: 12,
  outerAlpha: 0.35,
  middleWidth: 10,
  middleBlur: 6,
  middleAlpha: 0.75,
  coreWidth: 3,
  headRadius: 5,
  headGlowRadius: 14,
  headGlowAlpha: 0.9,
  ringCount: 2,
  ringStartRadius: 10,
  ringSpacing: 14,
  ringLineWidth: 2,
  ringPulseSpeed: 1.2,
  ringMaxAlpha: 0.6,
  particleCount: 4,
  particleRadius: 3,
  particleOrbitRadius: 22,
  particleSpeed: 0.06,
  particleAlpha: 0.6,
  fadeAlpha: 0.05,
  idleFadeFrames: 64,
} as const;

/**
 * A green glowing trail and pointer effect, independent of sampling and signaling.
 */
export class DefaultTrajectoryEffectRenderer implements TrajectoryEffectRendering {

  /**
   * The element containing the trail and pointer-effect layers.
   */
  readonly element = document.createElement("div");

  /**
   * The Canvas drawing trajectory strokes.
   */
  private readonly trailCanvas = document.createElement("canvas");

  /**
   * The Canvas drawing pointer halos.
   */
  private readonly effectCanvas = document.createElement("canvas");

  /**
   * The pending animation-frame handle.
   */
  private animation?: number;

  /**
   * Whether trail pixels remain to fade.
   */
  private hasTrailPixels = false;

  /**
   * The number of fade frames since the last active pointer.
   */
  private idleFadeFrames = 0;

  /**
   * The current pointers and their press timestamps.
   */
  private readonly pointers = new Map<TrajectoryID, {
    point: TrajectoryPoint;
    startedAt: number
  }>();

  /**
   * The trajectory segments awaiting drawing.
   */
  private readonly segments: Array<{
    from: TrajectoryPoint;
    to: TrajectoryPoint
  }> = [];

  /**
   * Creates independent visual layers without registering pointer events.
   */
  constructor() {
    for (const canvas of [this.trailCanvas, this.effectCanvas]) {
      Object.assign(
        canvas.style,
        {
          position: "absolute",
          inset: "0",
          width: "100%",
          height: "100%",
          pointerEvents: "none"
        }
      );
      this.element.appendChild(canvas);
    }
  }

  /**
   * Starts pointer decorations with pulse time relative to each press.
   */
  renderBegan(
    points: readonly TrajectoryPoint[]
  ): void {
    for (const point of points) {
      this.pointers.set(
        point.id,
        {
          point,
          startedAt: point.timestamp
        }
      );
    }
    this.idleFadeFrames = 0;
    this.schedule();
  }

  /**
   * Draws new segments while old pixels fade, without repeatedly brightening the full trajectory.
   */
  renderMoved(
    points: readonly TrajectoryPoint[]
  ): void {
    for (const point of points) {
      const pointer = this.pointers.get(point.id);
      if (pointer) {
        this.segments.push({
          from: pointer.point,
          to: point
        });
        pointer.point = point;
      }
    }
    this.schedule();
  }

  /**
   * Removes pointer decorations on release while retaining trail fade-out.
   */
  renderEnded(
    identifiers: readonly TrajectoryID[]
  ): void {
    for (const id of identifiers) {
      this.pointers.delete(id);
    }
    this.schedule();
  }

  /**
   * Clears drawing state and animation, allowing the renderer to be mounted again.
   */
  reset(): void {
    if (this.animation !== undefined) {
      cancelAnimationFrame(this.animation);
    }
    this.animation = undefined;
    this.pointers.clear();
    this.segments.length = 0;
    this.hasTrailPixels = false;
    this.idleFadeFrames = 0;
    for (const canvas of [this.trailCanvas, this.effectCanvas]) {
      canvas.getContext("2d")?.clearRect(
        0,
        0,
        canvas.width,
        canvas.height
      );
    }
  }

  /**
   * Requests animation only while pointers, segments, or fading pixels remain.
   */
  private schedule(): void {
    if (this.animation === undefined && (this.pointers.size || this.segments.length || this.hasTrailPixels)) {
      this.animation = requestAnimationFrame(now => this.draw(now));
    }
  }

  /**
   * Synchronizes Canvas resolution and updates trail and pointer layers.
   */
  private draw(
    now: number
  ): void {
    this.animation = undefined;
    const trail = this.trailCanvas.getContext("2d");
    const effects = this.effectCanvas.getContext("2d");
    if (!trail || !effects) {
      this.reset();
      return;
    }

    const rect = this.element.getBoundingClientRect();
    const dpr = globalThis.devicePixelRatio || 1;
    const width = Math.max(1, Math.round(rect.width * dpr));
    const height = Math.max(1, Math.round(rect.height * dpr));
    for (const canvas of [this.trailCanvas, this.effectCanvas]) {
      if (canvas.width !== width || canvas.height !== height) {
        canvas.width = width;
        canvas.height = height;
        this.hasTrailPixels = false;
      }
    }

    if (this.hasTrailPixels) {
      trail.save();
      trail.globalCompositeOperation = "destination-out";
      trail.fillStyle = "rgba(0,0,0," + VISUAL.fadeAlpha + ")";
      trail.fillRect(
        0,
        0,
        width,
        height
      );
      trail.restore();
    }
    if (this.segments.length) {
      this.drawSegments(
        trail,
        dpr
      );
      this.segments.length = 0;
      this.hasTrailPixels = true;
      this.idleFadeFrames = 0;
    }

    effects.clearRect(
      0,
      0,
      width,
      height
    );
    effects.save();
    effects.globalCompositeOperation = "lighter";
    for (const { point, startedAt } of this.pointers.values()) {
      const x = point.location.x * dpr;
      const y = point.location.y * dpr;
      if (this.pointers.size === 1) {
        this.drawRings(
          effects,
          x,
          y,
          dpr,
          (now - startedAt) / 1000
        );
        this.drawParticles(
          effects,
          x,
          y,
          dpr,
          (now - startedAt) / 1000
        );
      }
      this.drawGlow(
        effects,
        x,
        y,
        VISUAL.headGlowRadius * dpr,
        VISUAL.headGlowAlpha,
        true
      );
      effects.fillStyle = "rgba(255,255,255,1)";
      effects.beginPath();
      effects.arc(
        x,
        y,
        VISUAL.headRadius * dpr,
        0,
        Math.PI * 2
      );
      effects.fill();
    }
    effects.restore();

    if (this.pointers.size) {
      this.idleFadeFrames = 0;
    } else if (this.hasTrailPixels && ++this.idleFadeFrames > VISUAL.idleFadeFrames) {
      trail.clearRect(
        0,
        0,
        width,
        height
      );
      this.hasTrailPixels = false;
      this.idleFadeFrames = 0;
    }
    this.schedule();
  }

  /**
   * Draws green outer and middle glows with a white core, omitting shadows for multiple pointers to
   * reduce drawing cost.
   */
  private drawSegments(
    context: CanvasRenderingContext2D,
    dpr: number
  ): void {
    const layers = [
      {
        width: VISUAL.outerWidth,
        blur: VISUAL.outerBlur,
        color: this.green(VISUAL.outerAlpha)
      },
      {
        width: VISUAL.middleWidth,
        blur: VISUAL.middleBlur,
        color: this.green(VISUAL.middleAlpha)
      },
      {
        width: VISUAL.coreWidth,
        blur: 0,
        color: "rgba(255,255,255,1)"
      },
    ];
    for (const layer of layers) {
      context.save();
      context.globalCompositeOperation = "lighter";
      context.lineCap = "round";
      context.lineJoin = "round";
      context.lineWidth = layer.width * dpr;
      context.strokeStyle = layer.color;
      context.shadowBlur = this.pointers.size > 1 ? 0 : layer.blur * dpr;
      context.shadowColor = context.shadowBlur ? layer.color : "transparent";
      context.beginPath();
      for (const { from, to } of this.segments) {
        context.moveTo(
          from.location.x * dpr,
          from.location.y * dpr
        );
        context.lineTo(
          to.location.x * dpr,
          to.location.y * dpr
        );
      }
      context.stroke();
      context.restore();
    }
  }

  /**
   * Draws two pointer rings with different pulse phases.
   */
  private drawRings(
    context: CanvasRenderingContext2D,
    x: number,
    y: number,
    dpr: number,
    elapsed: number
  ): void {
    context.lineWidth = VISUAL.ringLineWidth * dpr;
    for (let index = 0; index < VISUAL.ringCount; index++) {
      const pulse = (Math.sin((elapsed * VISUAL.ringPulseSpeed + index * 0.5) * Math.PI * 2) + 1) / 2;
      const radius = (VISUAL.ringStartRadius + index * VISUAL.ringSpacing + pulse * 6) * dpr;
      context.strokeStyle = this.green(VISUAL.ringMaxAlpha * (1 - index * 0.2) * (0.5 + pulse * 0.5));
      context.beginPath();
      context.arc(
        x,
        y,
        radius,
        0,
        Math.PI * 2
      );
      context.stroke();
    }
  }

  /**
   * Draws four softly orbiting particles with alternating motion.
   */
  private drawParticles(
    context: CanvasRenderingContext2D,
    x: number,
    y: number,
    dpr: number,
    elapsed: number
  ): void {
    for (let index = 0; index < VISUAL.particleCount; index++) {
      const direction = index % 2 === 0 ? 1 : -1;
      const angle = index / VISUAL.particleCount * Math.PI * 2 + elapsed * VISUAL.particleSpeed * direction;
      const radius = VISUAL.particleOrbitRadius * dpr;
      const alpha = VISUAL.particleAlpha * (0.6 + Math.sin(elapsed * 3 + index) * 0.4);
      this.drawGlow(
        context,
        x + Math.cos(angle) * radius,
        y + Math.sin(angle) * radius,
        VISUAL.particleRadius * 2 * dpr,
        alpha
      );
    }
  }

  /**
   * Draws a radial green halo with an additional midtone at the pointer center.
   */
  private drawGlow(
    context: CanvasRenderingContext2D,
    x: number,
    y: number,
    radius: number,
    alpha: number,
    head = false
  ): void {
    const gradient = context.createRadialGradient(
      x,
      y,
      0,
      x,
      y,
      radius
    );
    gradient.addColorStop(
      0,
      this.green(alpha)
    );
    if (head) {
      gradient.addColorStop(
        0.4,
        this.green(alpha * 0.6)
      );
    }
    gradient.addColorStop(
      1,
      this.green(0)
    );
    context.fillStyle = gradient;
    context.beginPath();
    context.arc(
      x,
      y,
      radius,
      0,
      Math.PI * 2
    );
    context.fill();
  }

  /**
   * Returns the shared trajectory color at the requested opacity.
   */
  private green(
    alpha: number
  ): string {
    return "rgba(0,255,100," + alpha + ")";
  }
}
