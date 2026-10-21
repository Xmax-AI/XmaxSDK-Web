//
//  RemoteVideoFramePipeline.ts
//  XmaxSDK
//
//  Author: 翁跃庭 (Yueting Weng)
//  GitHub: https://github.com/Xmax-AI/XmaxSDK-Web
//
//  Copyright (c) 2026 XMAX.AI PTE. LTD.
//

import { FrameInterpolationManager, type FrameInterpolationProcessing } from "../../Foundation/Media/Video/FrameInterpolationManager";
import type { ModelSize } from "../../Service/Realtime/RealtimeModel";

/**
 * 插帧输出按 60 fps 预算处理，每对源帧最多插入一帧。
 */
const INTERPOLATION_FRAME_RATE = 60;

/**
 * 远端插帧尺寸及运行状态回调。
 */
export interface RemoteFrameInterpolationOptions {

  /**
   * 当前视频画面的像素尺寸。
   */
  size: ModelSize;

  /**
   * 插帧画布开始或停止输出时通知上层。
   */
  onActiveChange?: (
    active: boolean
  ) => void;

  /**
   * 实际提交画布呈现时通知，参数表示是否为插值帧。
   */
  onFramePresented?: (
    interpolated: boolean
  ) => void;

  /**
   * 插帧初始化或运行失败时通知上层。
   */
  onFailure: (
    error: unknown
  ) => void;
}

/**
 * 按画布、尺寸和取消信号创建插帧处理器。
 */
type ProcessorFactory = typeof FrameInterpolationManager.create;

/**
 * 等待按媒体时间呈现的 GPU 纹理帧。
 */
interface QueuedFrame {

  /**
   * 当前帧所在的 GPU 纹理槽位。
   */
  slot: number;

  /**
   * 当前帧的媒体显示时间，单位为毫秒。
   */
  time: number;

  /**
   * 是否为根据相邻原帧生成的中间帧。
   */
  interpolated?: boolean;
}

/**
 * 远端帧显示管线：帧按时间戳排队，显示时钟按 vsync 推进。
 *
 * 输入仍来自 video 元素的帧回调，但接管后画面始终由 canvas 输出，
 * 不再切回 video，因此不会显示比当前更旧的内容。输出整体延迟一个
 * 源帧间隔，为中间帧留出计算窗口；迟到的中间帧直接丢弃不补播。
 */
export class RemoteVideoFramePipeline {

  /**
   * 捕获原帧并计算中间帧的 GPU 处理器。
   */
  private processor?: FrameInterpolationProcessing;

  /**
   * 取消当前媒体操作及相关等待。
   */
  private readonly abort = new AbortController();

  /**
   * 等待下一帧视频回调的句柄。
   */
  private callback?: number;

  /**
   * 下一次显示节拍的动画回调句柄。
   */
  private raf?: number;

  /**
   * 限制单次 GPU 插帧等待时间的定时器。
   */
  private stallTimer?: ReturnType<typeof setTimeout>;

  /**
   * 限制 GPU 处理器初始化等待时间的定时器。
   */
  private initializationTimer?: ReturnType<typeof setTimeout>;

  /**
   * 是否正在初始化插帧处理器。
   */
  private loading = false;

  /**
   * 是否正在等待本次插帧计算完成。
   */
  private busy = false;

  /**
   * 是否已停止调度并释放当前管线。
   */
  private stopped = false;

  /**
   * 显示时间线版本，丢弃重置前的 GPU 计算结果。
   */
  private generation = 0;

  /**
   * 播放时钟锚点：最近一次输入帧的媒体时间与对应的 vsync 时刻。
   */
  private anchor?: {
    media: number;
    at: number
  };

  /**
   * 输出延迟，取最近一次有效源帧间隔，为中间帧留出计算窗口。
   */
  private delay = 0;

  /**
   * 按显示时间排列的待呈现帧。
   */
  private queue: QueuedFrame[] = [];

  /**
   * 最近一次已呈现帧的媒体时间，单位为毫秒。
   */
  private displayedTime?: number;

  /**
   * 上一张原始帧的媒体时间，单位为毫秒。
   */
  private previousTime?: number;

  /**
   * 上一张原始帧的纹理槽位。
   */
  private previousSlot?: number;

  /**
   * 上一张原始帧的浏览器呈现序号。
   */
  private previousPresented?: number;

  /**
   * 连续超出 GPU 帧预算的帧对数量。
   */
  private slowPairs = 0;

  /**
   * 当前功能是否处于活动状态。
   */
  private active = false;

  /**
   * 帧时间基准：媒体时间异常后，本管线持续使用回调时钟，避免反复切换。
   */
  private timeSource: "mediaTime" | "callback" = "mediaTime";

  /**
   * 绑定原始视频、输出画布和插帧处理器创建方式。
   */
  constructor(
    private readonly video: HTMLVideoElement,
    private readonly canvas: HTMLCanvasElement,
    private readonly options: RemoteFrameInterpolationOptions,
    private readonly createProcessor: (
      ...args: Parameters<ProcessorFactory>
    ) => Promise<FrameInterpolationProcessing> = FrameInterpolationManager.create,
  ) { }

  /**
   * 开始观察远端视频帧，浏览器不支持帧回调时报告失败。
   */
  start(): void {
    if (this.stopped || this.callback !== undefined)
      return;
    if (typeof this.video.requestVideoFrameCallback !== "function") {
      this.fail(new Error("Video frame callbacks are unavailable"));
      return;
    }
    this.observe();
  }

  /**
   * 持续注册原始帧回调，并将处理异常交给失败回调。
   */
  private observe(): void {
    if (this.stopped)
      return;
    this.callback = this.video.requestVideoFrameCallback((now, metadata) => {
      this.callback = undefined;
      if (this.stopped)
        return;
      try {
        this.frame(now, metadata);
      } catch (error) {
        this.fail(error);
      }
      this.observe();
    });
  }

  /**
   * 校验源帧尺寸与时间戳，提交原帧并按预算安排中间帧。
   */
  private frame(
    now: number,
    metadata: VideoFrameCallbackMetadata
  ): void {
    if (typeof document !== "undefined" && document.hidden) {
      this.resetTimeline();
      return;
    }
    if (metadata.width !== this.options.size.width || metadata.height !== this.options.size.height) {
      // 回传尺寸变更在生效前继续显示原视频，不能跨尺寸做插值。
      this.resetTimeline();
      return;
    }
    if (!this.processor) {
      if (!this.loading)
        void this.initialize();
      return;
    }
    const time = this.resolveFrameTime(now, metadata);
    if (time === undefined)
      return;

    const previous = this.previousTime;
    const interval = previous === undefined ? 0 : time - previous;
    const consecutive = this.previousPresented === undefined || metadata.presentedFrames === this.previousPresented + 1;
    const previousSlot = this.previousSlot;
    this.anchor = { media: time, at: now };
    this.previousTime = time;
    this.previousPresented = metadata.presentedFrames;
    const slot = this.processor.capture(this.video);
    this.previousSlot = slot;
    if (previous === undefined || interval > 250) {
      // 首帧与断流恢复直接显示当前帧；旧队列内容都已过期。
      this.queue = [];
      this.delay = 0;
      this.present({ slot, time });
      this.startTick();
      return;
    }
    this.delay = interval;
    this.enqueue({ slot, time });
    this.startTick();
    // 跳帧或间隔超出输出预算时只显示原帧，不做插值。
    if (!consecutive || interval < 2000 / INTERPOLATION_FRAME_RATE - 1 || previousSlot === undefined || this.busy) {
      return;
    }
    this.interpolate(previousSlot, slot, previous, time, interval);
  }

  /**
   * 优先使用媒体时间；新帧的媒体时间异常时切换到单调回调时钟。
   */
  private resolveFrameTime(
    now: number,
    metadata: VideoFrameCallbackMetadata
  ): number | undefined {
    // 帧序号没有前进时仍然丢弃，不能将同一帧当作时间戳兼容问题。
    if (this.previousPresented !== undefined && metadata.presentedFrames <= this.previousPresented) {
      return undefined;
    }

    let time = this.timeSource === "mediaTime" ? metadata.mediaTime * 1000 : now;
    if (!Number.isFinite(time) || (this.previousTime !== undefined && time <= this.previousTime)) {
      if (this.timeSource === "callback" || !Number.isFinite(now))
        return undefined;

      // 切换时清空旧时间基准的原帧、中间帧及显示锚点，迟到的 GPU 结果按版本丢弃。
      this.timeSource = "callback";
      this.resetTimeline(true);
      time = now;
    }

    return time;
  }

  /**
   * 帧按显示时间升序入队；同一时间的内容后到先出。
   */
  private enqueue(
    frame: QueuedFrame
  ): void {
    const index = this.queue.findIndex((queued) => queued.time >= frame.time);
    if (index < 0)
      this.queue.push(frame);
    else
      this.queue.splice(index, 0, frame);
  }

  /**
   * 计算相邻原帧的中间帧，丢弃过期或已错过显示时刻的结果。
   */
  private interpolate(
    previousSlot: number,
    currentSlot: number,
    previousTime: number,
    currentTime: number,
    interval: number
  ): void {
    const generation = this.generation;
    const midpoint = (previousTime + currentTime) / 2;
    const startedAt = performance.now();
    this.busy = true;
    this.stallTimer = setTimeout(() => {
      if (this.busy)
        this.fail(new Error("Interpolation GPU submission timed out"));
    }, Math.max(100, interval * 3));
    void this.processor!.interpolate(previousSlot, currentSlot).then((slot) => {
      if (this.stopped)
        return;
      this.busy = false;
      clearTimeout(this.stallTimer);
      this.stallTimer = undefined;
      if (generation !== this.generation)
        return;
      const elapsed = performance.now() - startedAt;
      this.slowPairs = elapsed > interval / 2 ? this.slowPairs + 1 : 0;
      if (this.slowPairs >= 5) {
        this.fail(new Error("Interpolation exceeded the GPU frame budget for 5 consecutive pairs"));
        return;
      }
      // 显示时钟已越过中点的中间帧直接丢弃，不补播。
      if (this.position(performance.now()) >= midpoint) {
        return;
      }
      this.enqueue({ slot, time: midpoint, interpolated: true });
    }).catch((error) => {
      if (!this.stopped)
        this.fail(error);
    });
  }

  /**
   * 显示时钟位置：锚点媒体时间随墙钟推进，整体后移一个源帧间隔。
   */
  private position(
    now: number
  ): number {
    if (!this.anchor)
      return -Infinity;
    return this.anchor.media + (now - this.anchor.at) - this.delay;
  }

  /**
   * vsync 显示节拍：弹出到点的帧并显示最新的一张。
   */
  private readonly tick = (now: number): void => {
    if (this.stopped)
      return;
    this.raf = requestAnimationFrame(this.tick);
    const position = this.position(now);
    let frame: QueuedFrame | undefined;
    while (this.queue.length > 0 && this.queue[0]!.time <= position) {
      frame = this.queue.shift();
    }
    if (frame)
      this.present(frame);
  };

  /**
   * 按浏览器显示节拍启动待呈现帧调度。
   */
  private startTick(): void {
    if (this.raf === undefined)
      this.raf = requestAnimationFrame(this.tick);
  }

  /**
   * 呈现指定纹理帧并通知帧统计。
   */
  private present(
    frame: QueuedFrame
  ): void {
    // 环形槽位会复用，按时间戳去重而不是按槽位。
    if (this.displayedTime === frame.time)
      return;
    this.processor!.present(frame.slot);
    this.displayedTime = frame.time;
    this.canvas.style.visibility = "visible";
    this.setActive(true);
    this.options.onFramePresented?.(frame.interpolated ?? false);
  }

  /**
   * 创建 GPU 处理器，并限制初始化等待时长。
   */
  private async initialize(): Promise<void> {
    this.loading = true;
    this.initializationTimer = setTimeout(() => this.fail(new Error("Interpolation initialization timed out")), 15_000);
    try {
      const processor = await this.createProcessor(this.canvas, this.options.size,
        (error) => this.fail(error), this.abort.signal);
      if (this.stopped) {
        processor.destroy();
        return;
      }
      this.processor = processor;
    } catch (error) {
      if (!this.stopped)
        this.fail(error);
    } finally {
      clearTimeout(this.initializationTimer);
      this.initializationTimer = undefined;
      this.loading = false;
    }
  }

  /**
   * 更新插帧画布的活动状态并通知上层。
   */
  private setActive(
    active: boolean
  ): void {
    if (active === this.active)
      return;
    this.active = active;
    this.options.onActiveChange?.(active);
  }

  /**
   * 清除待呈现帧和时间锚点，使旧插帧结果失效。
   */
  private resetTimeline(
    preserveGpuTimeout = false
  ): void {
    this.generation++;
    this.queue = [];
    // 仅切换时间基准时保留在途 GPU 的原有超时，不改变计算保护行为。
    if (!preserveGpuTimeout) {
      clearTimeout(this.stallTimer);
      this.stallTimer = undefined;
    }
    if (this.raf !== undefined)
      cancelAnimationFrame(this.raf);
    this.raf = undefined;
    this.anchor = undefined;
    this.delay = 0;
    this.displayedTime = undefined;
    this.previousTime = undefined;
    this.previousSlot = undefined;
    this.previousPresented = undefined;
    this.canvas.style.visibility = "hidden";
    this.setActive(false);
  }

  /**
   * 停止插帧资源并交付失败原因。
   */
  private fail(
    error: unknown
  ): void {
    if (this.stopped)
      return;
    this.stop();
    this.options.onFailure(error);
  }

  /**
   * 取消帧观察和显示调度，并释放 GPU 处理器。
   */
  stop(): void {
    if (this.stopped)
      return;
    this.stopped = true;
    this.abort.abort();
    if (this.callback !== undefined)
      this.video.cancelVideoFrameCallback(this.callback);
    this.callback = undefined;
    clearTimeout(this.initializationTimer);
    this.resetTimeline();
    this.processor?.destroy();
    this.processor = undefined;
  }
}
