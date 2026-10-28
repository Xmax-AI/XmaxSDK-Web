//
//  RenderWarmupController.ts
//  XmaxSDK
//
//  Author: 翁跃庭 (Yueting Weng)
//  GitHub: https://github.com/Xmax-AI/XmaxSDK-Web
//
//  Copyright (c) 2026 XMAX.AI PTE. LTD.
//

import { XmaxError, XmaxErrorCode } from "../../Foundation/Errors/XmaxError";

/**
 * Keeps video playing through initial warmup before fade-in, without buffering or modifying frames.
 */
export class RenderWarmupController {

  /**
   * The configured warmup duration, in milliseconds.
   */
  private durationMs?: number;

  /**
   * The pending warmup timer.
   */
  private timer?: ReturnType<typeof setTimeout>;

  /**
   * Whether warmup has started.
   */
  private started = false;

  /**
   * Whether the current warmup has completed.
   */
  private completed = false;

  /**
   * The next fade-in duration, in milliseconds.
   */
  private currentFadeInDurationMs = 300;

  /**
   * Creates a presentation warmup controller; fade settings do not change first-frame or
   * warmup-completion timing.
   *
   * @param element - The media layer whose visibility and fade are controlled.
   * @param fadeInDurationMs - Fade duration after warmup, in milliseconds; defaults to 300. Zero
   * displays immediately.
   * @throws An invalidConfiguration error for negative or nonfinite durations.
   */
  constructor(
    private readonly element: HTMLElement,
    fadeInDurationMs = 300
  ) {
    this.fadeInDurationMs = fadeInDurationMs;
  }

  /**
   * The configured fade-in duration, in milliseconds.
   */
  get fadeInDurationMs(): number {
    return this.currentFadeInDurationMs;
  }

  /**
   * Updates the next fade without changing an active animation or first-frame warmup.
   */
  set fadeInDurationMs(
    fadeInDurationMs: number
  ) {
    if (!Number.isFinite(fadeInDurationMs) || fadeInDurationMs < 0) {
      throw new XmaxError(
        XmaxErrorCode.invalidConfiguration,
        "fadeInDurationMs must be a finite non-negative number"
      );
    }
    this.currentFadeInDurationMs = fadeInDurationMs;
  }

  /**
   * Whether presentation is waiting for a first frame or warmup completion.
   */
  get isPending(): boolean {
    return this.durationMs !== undefined && !this.completed;
  }

  /**
   * Hides new media during warmup; undefined displays immediately without warmup.
   */
  prepare(
    durationMs?: number
  ): void {
    this.reset();
    this.durationMs = durationMs;
    if (durationMs === undefined) {
      return;
    }

    this.element.style.transition = "none";
    this.element.style.opacity = "0";
    this.element.style.pointerEvents = "none";
  }

  /**
   * Starts one warmup after first-frame readiness, then notifies and fades in.
   */
  start(
    onCompleted: () => void
  ): void {
    if (this.durationMs === undefined || this.started) {
      return;
    }

    this.started = true;
    this.timer = setTimeout(
      () => {
        this.timer = undefined;
        this.completed = true;
        const reduceMotion = globalThis.matchMedia?.("(prefers-reduced-motion: reduce)").matches;
        this.element.style.transition = reduceMotion || this.fadeInDurationMs === 0
          ? "none" : `opacity ${this.fadeInDurationMs}ms ease-in-out`;
        this.element.style.opacity = "1";
        this.element.style.pointerEvents = "";
        onCompleted();
      },
      this.durationMs
    );
  }

  /**
   * Cancels warmup and fade during replacement or unmounting so obsolete tasks cannot reveal new media.
   */
  reset(): void {
    clearTimeout(this.timer);
    this.timer = undefined;
    this.started = false;
    this.completed = false;
    if (this.durationMs !== undefined) {
      this.element.style.transition = "";
      this.element.style.opacity = "";
      this.element.style.pointerEvents = "";
    }
    this.durationMs = undefined;
  }
}
