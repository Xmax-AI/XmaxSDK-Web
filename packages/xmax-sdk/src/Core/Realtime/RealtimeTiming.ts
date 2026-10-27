//
//  RealtimeTiming.ts
//  XmaxSDK
//
//  Author: 翁跃庭 (Yueting Weng)
//  GitHub: https://github.com/Xmax-AI/XmaxSDK-Web
//
//  Copyright (c) 2026 XMAX.AI PTE. LTD.
//

import type {
  RealtimeTiming as RealtimeTimingSnapshot,
  RealtimeTimingListener,
} from "../../Service/Realtime/RealtimeTiming";
import { XmaxLogger, XmaxLoggerOption } from "../../Foundation/Logging/XmaxLogger";

/**
 * @internal 观察媒体源首轮启动耗时，提供快照并在预热完成后输出性能日志。
 * 不参与生成流程的状态提交或等待。
 */
export class RealtimeTiming {

  /**
   * 统计快照与观察者
   */
  private snapshot: RealtimeTimingSnapshot = Object.freeze({});

  /**
   * 启动耗时快照的业务监听器。
   */
  private listener?: RealtimeTimingListener;

  /**
   * 当前启动周期与计时起点
   */
  private sequence = 0;

  /**
   * 当前启动周期是否仍在记录耗时。
   */
  private active = false;

  /**
   * 当前计时起点，使用单调时钟的毫秒值。
   */
  private startedAt = 0;

  /**
   * 设置统计监听器并立即回放当前快照；传 undefined 取消监听。
   */
  setListener(
    listener?: RealtimeTimingListener
  ): void {
    this.listener = listener;
    this.notify();
  }

  /**
   * 开始新的启动周期并清空旧快照，返回记录相机创建完成的一次性回调。
   */
  startCamera(): () => void {
    this.start();
    return this.measure("cameraMs", this.startedAt);
  }

  /**
   * 开始新的启动周期；非摄像头源不产生相机耗时。
   */
  start(): void {
    this.sequence += 1;
    this.active = true;
    this.startedAt = performance.now();
    this.snapshot = Object.freeze({});

    this.notify();
  }

  /**
   * 开始等待用户授权系统媒体权限，返回授权决定时调用的记录函数。
   * 仅在系统弹出授权请求时使用；已授权或未弹窗不记录该阶段。
   */
  startPermission(): () => void {
    return this.measure("permissionMs", performance.now());
  }

  /**
   * 开始创建业务会话的计时。
   */
  startSession(): () => void {
    return this.measure("sessionMs", performance.now());
  }

  /**
   * 开始 RTC 适配器进房调用的计时。
   */
  startRtcJoin(): () => void {
    return this.measure("rtcJoinMs", performance.now());
  }

  /**
   * 开始发布本地流计时，返回发布完成时调用的记录函数。
   */
  startPublish(): () => void {
    return this.measure("publishMs", performance.now());
  }

  /**
   * 开始等待远端首帧提交合成器，不包含后续渲染预热。
   */
  startFirstFrame(): () => void {
    return this.measure("firstFrameMs", performance.now());
  }

  /**
   * 首帧就绪后开始渲染预热；结束时记录预热及实际总耗时，不含渐入动画。
   */
  startRenderWarmup(): () => void {
    return this.measure("renderWarmupMs", performance.now());
  }

  /**
   * 冻结本轮结果，令尚未完成的回调失效；下一轮创建媒体源时重置。
   */
  cancel(): void {
    this.active = false;
    this.sequence += 1;
  }

  /**
   * 创建当前周期的一次性计时回调；周期失效或该阶段已记录时忽略调用。
   */
  private measure(
    key: Exclude<keyof RealtimeTimingSnapshot, "totalMs">,
    startedAt: number,
  ): () => void {
    const sequence = this.sequence;
    return () => {
      if (!this.active || sequence !== this.sequence || this.snapshot[key] !== undefined) {
        return;
      }

      const now = performance.now();
      this.snapshot = Object.freeze({
        ...this.snapshot,
        [key]: now - startedAt,
        ...(key === "renderWarmupMs" ? { totalMs: now - this.startedAt } : {}),
      });

      if (key === "renderWarmupMs") {
        const snapshot = this.snapshot;
        XmaxLogger.realtime.info(() => this.format(snapshot), XmaxLoggerOption.performance);
      }

      this.notify();
    };
  }

  /**
   * 按快照口径格式化启动汇总，未完成或未启用的阶段显示占位符。
   */
  private format(
    snapshot: RealtimeTimingSnapshot
  ): string {
    const stages = [
      [XmaxLogger.localized("摄像头启动：", "Camera Startup: "), snapshot.cameraMs],
      [XmaxLogger.localized("媒体授权：", "Media Permission: "), snapshot.permissionMs],
      [XmaxLogger.localized("创建会话：", "Session Creation: "), snapshot.sessionMs],
      [XmaxLogger.localized("RTC 进房：", "RTC Room Join: "), snapshot.rtcJoinMs],
      [XmaxLogger.localized("发布本地流：", "Local Stream Publication: "), snapshot.publishMs],
      [XmaxLogger.localized("首帧到达：", "First Frame Arrival: "), snapshot.firstFrameMs],
      [XmaxLogger.localized("渲染预热：", "Render Warmup: "), snapshot.renderWarmupMs],
    ] as const;

    return [
      "实时生成启动耗时 (Realtime Generation Startup Timing)",
      `└─ ${XmaxLogger.localized("总耗时：", "Total Duration: ")}${this.duration(snapshot.totalMs)}`,
      ...stages.map(([label, duration], index) =>
        `   ${index === stages.length - 1 ? "└─" : "├─"} ${label}${this.duration(duration)}`,
      ),
    ].join("\n");
  }

  /**
   * 毫秒值保留一位小数，缺失或无效值显示占位符。
   */
  private duration(
    milliseconds?: number
  ): string {
    if (milliseconds === undefined || !Number.isFinite(milliseconds) || milliseconds < 0) {
      return "—";
    }

    return `${milliseconds.toFixed(1)} ms`;
  }

  /**
   * 分发不可变快照；隔离同步和异步观察者异常，避免影响媒体生命周期。
   */
  private notify(): void {
    try {
      // 异步监听器也允许使用；观察者异常不得影响媒体生命周期。
      void Promise.resolve(this.listener?.(this.snapshot)).catch(() => { });
    } catch {
      // 同步观察者异常同样隔离。
    }
  }
}
