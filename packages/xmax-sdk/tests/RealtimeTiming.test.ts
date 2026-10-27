import { afterEach, describe, expect, it, vi } from "vitest";
import { RealtimeTiming } from "../src/Core/Realtime/RealtimeTiming";
import type { RealtimeTiming as RealtimeTimingSnapshot } from "../src/Service/Realtime/RealtimeTiming";
import { XmaxLogger, XmaxLoggerOption } from "../src/Foundation/Logging/XmaxLogger";
import { XmaxEnvironment } from "../src/Foundation/Runtime/XmaxEnvironment";

afterEach(() => {
  XmaxLogger.configure(XmaxLoggerOption.none);
  vi.restoreAllMocks();
});

describe("RealtimeTiming connection stages", () => {
  it("keeps first frame separate and completes total only after render warmup", () => {
    let now = 0;
    vi.spyOn(performance, "now").mockImplementation(() => now);
    const timer = new RealtimeTiming();
    const listener = vi.fn();
    timer.setListener(listener);
    timer.start();
    now = 500;
    const firstFrame = timer.startFirstFrame();
    now = 800;
    firstFrame();
    expect(listener).toHaveBeenLastCalledWith({ firstFrameMs: 300 });
    const warmup = timer.startRenderWarmup();
    now = 1800;
    warmup();
    expect(listener).toHaveBeenLastCalledWith({ firstFrameMs: 300, renderWarmupMs: 1000, totalMs: 1800 });
    now = 2300;
    warmup();
    expect(listener).toHaveBeenLastCalledWith({ firstFrameMs: 300, renderWarmupMs: 1000, totalMs: 1800 });
  });

  it("records each stage once without completing the overall launch", () => {
    let now = 0;
    vi.spyOn(performance, "now").mockImplementation(() => now);
    const timer = new RealtimeTiming();
    const snapshots: RealtimeTimingSnapshot[] = [];
    timer.setListener(value => { snapshots.push(value); });
    timer.start();
    for (const [start, duration] of [
      [() => timer.startSession(), 120],
      [() => timer.startRtcJoin(), 350],
    ] as const) {
      const complete = start();
      now += duration;
      complete();
      complete();
    }
    expect(snapshots.at(-1)).toEqual({ sessionMs: 120, rtcJoinMs: 350 });
    expect(snapshots).toHaveLength(4);
    expect(Object.isFrozen(snapshots.at(-1))).toBe(true);
  });

  it("ignores cancelled and previous-cycle completion callbacks", () => {
    const timer = new RealtimeTiming();
    const listener = vi.fn();
    timer.setListener(listener);
    timer.start();
    const completeJoin = timer.startRtcJoin();
    const completeSession = timer.startSession();
    const completeWarmup = timer.startRenderWarmup();
    timer.cancel();
    completeJoin();
    completeWarmup();
    expect(listener).toHaveBeenCalledTimes(2);
    timer.start();
    completeSession();
    expect(listener).toHaveBeenCalledTimes(3);
    expect(listener).toHaveBeenLastCalledWith({});
  });
});

describe("RealtimeTiming console summary", () => {
  it("logs one completed summary at info level without a timing listener", () => {
    XmaxLogger.configure(XmaxLoggerOption.performance);
    const info = vi.spyOn(console, "info").mockImplementation(() => {});
    const debug = vi.spyOn(console, "debug").mockImplementation(() => {});
    let now = 0;
    vi.spyOn(performance, "now").mockImplementation(() => now);
    const timing = new RealtimeTiming();
    timing.startCamera()();

    for (const [start, duration] of [
      [() => timing.startSession(), 120],
      [() => timing.startRtcJoin(), 350],
      [() => timing.startPublish(), 0],
      [() => timing.startFirstFrame(), 400],
    ] as const) {
      const complete = start();
      now += duration;
      complete();
    }
    expect(info).not.toHaveBeenCalled();

    const completeWarmup = timing.startRenderWarmup();
    now += 750;
    completeWarmup();
    expect(info).toHaveBeenCalledOnce();
    expect(info.mock.calls[0]!.at(-1)).toContain([
      "实时生成启动耗时 (Realtime Generation Startup Timing)",
      "└─ 总耗时：1620.0 ms",
      "   ├─ 摄像头启动：0.0 ms",
      "   ├─ 媒体授权：—",
      "   ├─ 创建会话：120.0 ms",
      "   ├─ RTC 进房：350.0 ms",
      "   ├─ 发布本地流：0.0 ms",
      "   ├─ 首帧到达：400.0 ms",
      "   └─ 渲染预热：750.0 ms",
    ].join("\n"));
    expect(debug).not.toHaveBeenCalled();

    // 重复的视图通知、回放和取消均不重复打印成功汇总。
    completeWarmup();
    timing.setListener(vi.fn());
    timing.cancel();
    completeWarmup();
    expect(info).toHaveBeenCalledOnce();
  });

  it("localizes stage names and includes permission duration", () => {
    XmaxLogger.configure(XmaxLoggerOption.performance, XmaxEnvironment.global);
    const info = vi.spyOn(console, "info").mockImplementation(() => {});
    let now = 100;
    vi.spyOn(performance, "now").mockImplementation(() => now);
    const timing = new RealtimeTiming();
    timing.start();
    const completePermission = timing.startPermission();
    now += 50.25;
    completePermission();
    timing.startFirstFrame()();
    const completeWarmup = timing.startRenderWarmup();
    now += 750;
    completeWarmup();

    const message = info.mock.calls[0]!.at(-1);
    expect(message).toContain("Total Duration: 800.3 ms");
    expect(message).toContain("Camera Startup: —");
    expect(message).toContain("Media Permission: 50.3 ms");
    expect(message).toContain("RTC Room Join: —");
    expect(message).toContain("First Frame Arrival: 0.0 ms");
    expect(message).toContain("Render Warmup: 750.0 ms");
    expect(message).not.toContain("总耗时：");
  });

  it.each([XmaxLoggerOption.none, XmaxLoggerOption.business])("keeps callbacks independent of disabled performance logs (%s)", options => {
    XmaxLogger.configure(options);
    const info = vi.spyOn(console, "info").mockImplementation(() => {});
    const timing = new RealtimeTiming();
    const listener = vi.fn();
    timing.setListener(listener);
    timing.start();
    timing.startFirstFrame()();
    timing.startRenderWarmup()();

    expect(listener).toHaveBeenLastCalledWith({
      firstFrameMs: expect.any(Number),
      renderWarmupMs: expect.any(Number),
      totalMs: expect.any(Number),
    });
    expect(info).not.toHaveBeenCalled();
  });

  it("does not log cancelled or stale completions and resets for the next media source", () => {
    XmaxLogger.configure(XmaxLoggerOption.performance);
    const info = vi.spyOn(console, "info").mockImplementation(() => {});
    const timing = new RealtimeTiming();
    timing.start();
    timing.startFirstFrame()();
    const staleWarmup = timing.startRenderWarmup();
    timing.cancel();
    staleWarmup();
    expect(info).not.toHaveBeenCalled();

    timing.start();
    staleWarmup();
    expect(info).not.toHaveBeenCalled();
    timing.startFirstFrame()();
    timing.startRenderWarmup()();
    expect(info).toHaveBeenCalledOnce();

    timing.start();
    timing.startFirstFrame()();
    timing.startRenderWarmup()();
    expect(info).toHaveBeenCalledTimes(2);
  });
});
