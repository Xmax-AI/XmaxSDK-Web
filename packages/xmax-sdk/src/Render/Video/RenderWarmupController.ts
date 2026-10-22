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
 * 首帧后保持视频播放，等待预热结束再渐入；不缓存或改写媒体帧。
 */
export class RenderWarmupController {

  /**
   * 预热配置与生命周期
   */
  private durationMs?: number;

  /**
   * 当前等待或定时任务的取消句柄。
   */
  private timer?: ReturnType<typeof setTimeout>;

  /**
   * 是否已经开始渲染预热。
   */
  private started = false;

  /**
   * 是否已经完成本次渲染预热。
   */
  private completed = false;

  /**
   * 创建视图预热控制器，渐入配置不改变首帧或预热完成的时机。
   *
   * @param element 需要控制预热显隐和渐入的媒体显示层。
   * @param fadeInDurationMs 预热完成后的渐入时长，单位为毫秒，默认 300；0 表示直接显示。
   * @throws 时长为负数或非有限数值时抛出 invalidConfiguration。
   */
  constructor(
    private readonly element: HTMLElement,
    private readonly fadeInDurationMs = 300
  ) {
    if (!Number.isFinite(fadeInDurationMs) || fadeInDurationMs < 0) {
      throw new XmaxError(XmaxErrorCode.invalidConfiguration, "fadeInDurationMs must be a finite non-negative number");
    }
  }

  /**
   * 媒体内容是否仍在等待首帧或预热完成。
   */
  get isPending(): boolean {
    return this.durationMs !== undefined && !this.completed;
  }

  /**
   * 为新媒体隐藏画面；undefined 表示直接显示，不启用预热。
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
   * 首帧就绪后开始一次性预热，结束时通知并渐入画面。
   */
  start(
    onCompleted: () => void
  ): void {
    if (this.durationMs === undefined || this.started) {
      return;
    }

    this.started = true;
    this.timer = setTimeout(() => {
      this.timer = undefined;
      this.completed = true;
      const reduceMotion = globalThis.matchMedia?.("(prefers-reduced-motion: reduce)").matches;
      this.element.style.transition = reduceMotion || this.fadeInDurationMs === 0
        ? "none" : `opacity ${this.fadeInDurationMs}ms ease-in-out`;
      this.element.style.opacity = "1";
      this.element.style.pointerEvents = "";
      onCompleted();
    }, this.durationMs);
  }

  /**
   * 换流或卸载时取消预热和渐入，防止旧任务显示新画面。
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
