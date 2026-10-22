import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { FrameInterpolationManager } from "../src/Foundation/Media/Video/FrameInterpolationManager";
import { XmaxLogger, XmaxLoggerOption } from "../src/Foundation/Logging/XmaxLogger";
import { XmaxVideoView } from "../src/Render/Video/XmaxVideoView";
import { XmaxRealtimeVideoView } from "../src/Render/Video/XmaxRealtimeVideoView";
import { RealtimeVideoTrack } from "../src/Service/Realtime/RealtimeVideoTrack";
import { VideoRenderRegistry } from "../src/Service/Realtime/VideoRenderBinding";
import { RealtimeVideoFormat } from "../src/Service/Realtime/RealtimeVideoFormat";

class ElementStub extends EventTarget {
  style: Record<string, string> = {};
  readonly children: ElementStub[] = [];
  appendChild(child: ElementStub): void { this.children.push(child); }
  remove(): void {}
}

class VideoStub extends ElementStub {
  currentTime = 0;
  ended = false;
  muted = false;
  loop = false;
  autoplay = true;
  pause = vi.fn(() => { this.paused = true; });
  srcObject: MediaStream | null = null;
  paused = true;
  readyState = 0;
  play = vi.fn(async () => { this.paused = false; });
  private sequence = 0;
  private presentedFrames = 0;
  readonly callbacks = new Map<number, () => void>();

  requestVideoFrameCallback(callback: () => void): number {
    const id = ++this.sequence;
    this.callbacks.set(id, callback);
    return id;
  }

  cancelVideoFrameCallback(id: number): void {
    this.callbacks.delete(id);
  }

  nextFrame(time = 0, frames = this.presentedFrames + 1): void {
    this.presentedFrames = frames;
    const callbacks = [...this.callbacks.values()];
    this.callbacks.clear();
    callbacks.forEach((callback) => (callback as VideoFrameRequestCallback)(performance.now(), {
      mediaTime: time, presentedFrames: frames, width: 320, height: 180,
    } as VideoFrameCallbackMetadata));
  }
}

function makeView(useFrameCallback = true, renderWarmupMs?: number) {
  const video = new VideoStub();
  if (!useFrameCallback) {
    Object.defineProperty(video, "requestVideoFrameCallback", { value: undefined });
  }
  vi.stubGlobal("document", {
    createElement: (tag: string) => tag === "video" ? video : new ElementStub(),
  });
  const view = new XmaxVideoView();
  const track = new RealtimeVideoTrack({ id: "remote" });
  const onBindingFrame = vi.fn();
  const onViewFrame = vi.fn();
  const onWarmup = vi.fn();
  view.frameDisplayHandler = onViewFrame;
  VideoRenderRegistry.register(track, {
    renderWarmupMs,
    renderWarmupCompletedHandler: onWarmup,
    attachHandler: (target) => target.setMediaStream({} as MediaStream),
    detachHandler: (target) => target.setMediaStream(null),
    frameDisplayHandler: onBindingFrame,
  });
  view.track = track;
  return { view, video, onBindingFrame, onViewFrame, onWarmup };
}

function mediaLayer(view: XmaxVideoView): ElementStub {
  return (view.element as unknown as ElementStub).children[0]!.children[0]!;
}

describe("video visibility", () => {
  afterEach(() => vi.unstubAllGlobals());

  it("hides only video content while preserving playback, frame callbacks and interaction settings", () => {
    const { view, video, onViewFrame } = makeView();
    const root = view.element as unknown as ElementStub;
    const videoLayer = root.children[0]!;
    const source = video.srcObject;
    const pauseCalls = video.pause.mock.calls.length;
    expect(view.isVideoVisible).toBe(true);
    expect(mediaLayer(view).children).toContain(video);

    view.isVideoVisible = false;
    expect(videoLayer.style.opacity).toBe("0");
    expect(root.style.opacity).toBeUndefined();
    expect(root.style.pointerEvents).toBeUndefined();
    expect(view.isInteractionEnabled).toBe(true);
    expect(video.srcObject).toBe(source);
    expect(video.pause).toHaveBeenCalledTimes(pauseCalls);
    video.nextFrame();
    expect(onViewFrame).toHaveBeenCalledOnce();

    view.isInteractionEnabled = false;
    view.isVideoVisible = true;
    expect(videoLayer.style.opacity).toBe("1");
    expect(view.isInteractionEnabled).toBe(false);
    expect(video.srcObject).toBe(source);
    view.detach();
  });

  it("preserves hidden video across warmup, generation preparation and stream changes", async () => {
    vi.useFakeTimers();
    try {
      const { view, video, onWarmup } = makeView(true, 1000);
      const layer = (view.element as unknown as ElementStub).children[0]!;
      view.isVideoVisible = false;
      video.nextFrame();
      await vi.advanceTimersByTimeAsync(1000);
      expect(onWarmup).toHaveBeenCalledOnce();
      expect(mediaLayer(view).style.opacity).toBe("1");
      expect(layer.style.opacity).toBe("0");
      view.prepareForGeneration();
      view.setMediaStream({} as MediaStream);
      video.nextFrame();
      await vi.advanceTimersByTimeAsync(1000);
      expect(layer.style.opacity).toBe("0");
      view.isVideoVisible = true;
      expect(layer.style.opacity).toBe("1");
      view.detach();
    } finally {
      vi.useRealTimers();
    }
  });
});

describe("remote render warmup", () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllGlobals();
  });

  it("rearms first-frame and warmup for a new generation without replacing the stream", async () => {
    const { view, video, onWarmup, onBindingFrame } = makeView(true, 1000);
    const media = video.srcObject;
    video.nextFrame();
    await vi.advanceTimersByTimeAsync(600);
    view.prepareForGeneration();
    expect(video.srcObject).toBe(media);
    await vi.advanceTimersByTimeAsync(1000);
    expect(onWarmup).not.toHaveBeenCalled();
    video.nextFrame();
    await vi.advanceTimersByTimeAsync(999);
    expect(onWarmup).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(1);
    expect(onBindingFrame).toHaveBeenCalledTimes(2);
    expect(onWarmup).toHaveBeenCalledOnce();
    view.detach();
  });

  it.each([true, false])("waits 1000 ms after the first frame then fades once (frame callback: %s)", async useFrameCallback => {
    const { view, video, onBindingFrame, onViewFrame, onWarmup } = makeView(useFrameCallback, 1000);
    expect(mediaLayer(view).style.opacity).toBe("0");
    expect(video.srcObject).not.toBeNull();
    await vi.advanceTimersByTimeAsync(2000);
    expect(onWarmup).not.toHaveBeenCalled();

    if (useFrameCallback) video.nextFrame();
    else video.dispatchEvent(new Event("playing"));
    expect(onBindingFrame).toHaveBeenCalledOnce();
    expect(onViewFrame).toHaveBeenCalledOnce();
    await vi.advanceTimersByTimeAsync(999);
    expect(mediaLayer(view).style.opacity).toBe("0");
    expect(onWarmup).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(1);
    expect(mediaLayer(view).style.opacity).toBe("1");
    expect(mediaLayer(view).style.transition).toBe("opacity 300ms ease-in-out");
    expect(view.element.style.opacity).toBeUndefined();
    expect(view.element.style.pointerEvents).toBeUndefined();
    expect(onWarmup).toHaveBeenCalledOnce();
    expect(video.pause).not.toHaveBeenCalled();
    video.nextFrame();
    await vi.advanceTimersByTimeAsync(2000);
    expect(onWarmup).toHaveBeenCalledOnce();
    view.detach();
  });

  it.each(["detach", "clear", "replace"])("cancels pending warmup on %s", async action => {
    const { view, video, onWarmup } = makeView(true, 1000);
    video.nextFrame();
    await vi.advanceTimersByTimeAsync(600);
    if (action === "detach") view.detach();
    else if (action === "clear") view.track = undefined;
    else view.setMediaStream({} as MediaStream);
    await vi.advanceTimersByTimeAsync(1000);
    expect(onWarmup).not.toHaveBeenCalled();

    if (action === "detach") view.attach(new ElementStub() as unknown as HTMLElement);
    if (action !== "clear") {
      video.nextFrame();
      await vi.advanceTimersByTimeAsync(1000);
      expect(onWarmup).toHaveBeenCalledOnce();
    }
    view.detach();
    expect(vi.getTimerCount()).toBe(0);
  });

  it("does not delay a local binding and respects reduced motion for remote fade", async () => {
    const local = makeView();
    local.video.nextFrame();
    expect(mediaLayer(local.view).style.opacity).not.toBe("0");
    expect(vi.getTimerCount()).toBe(0);
    local.view.detach();

    vi.stubGlobal("matchMedia", () => ({ matches: true }));
    const remote = makeView(true, 1000);
    remote.video.nextFrame();
    await vi.advanceTimersByTimeAsync(1000);
    expect(mediaLayer(remote.view).style.opacity).toBe("1");
    expect(mediaLayer(remote.view).style.transition).toBe("none");
    remote.view.detach();
  });

  it("uses the same warmup in the composite view without a second fade", async () => {
    const videos: VideoStub[] = [];
    vi.stubGlobal("document", {
      createElement: (tag: string) => {
        if (tag !== "video") return new ElementStub();
        const video = new VideoStub();
        videos.push(video);
        return video;
      },
    });
    const animate = vi.fn();
    vi.stubGlobal("requestAnimationFrame", animate);
    const remoteTrack = new RealtimeVideoTrack({ id: "remote" });
    const onWarmup = vi.fn();
    let target: XmaxVideoView | undefined;
    VideoRenderRegistry.register(remoteTrack, {
      renderWarmupMs: 1000,
      renderWarmupCompletedHandler: onWarmup,
      attachHandler: view => {
        target = view as XmaxVideoView;
        view.setMediaStream({} as MediaStream);
      },
      detachHandler: view => view.setMediaStream(null),
    });
    const view = new XmaxRealtimeVideoView({ remoteTrack });
    expect(target!.element.style.visibility).toBe("visible");
    expect(target!.element.style.opacity).toBe("1");
    expect(target!.element.style.backgroundColor).toBe("transparent");
    expect(mediaLayer(target!).style.opacity).toBe("0");
    videos[1]!.nextFrame();
    await vi.advanceTimersByTimeAsync(1000);
    expect(target!.element.style.opacity).toBe("1");
    expect(mediaLayer(target!).style.opacity).toBe("1");
    expect(onWarmup).toHaveBeenCalledOnce();
    expect(animate).not.toHaveBeenCalled();
    view.remoteTrack = undefined;
    expect(target!.element.style.opacity).toBe("0");
    view.detach();
  });
});

describe("video render statistics", () => {
  beforeEach(() => {
    vi.useFakeTimers({ toFake: ["setInterval", "clearInterval", "setTimeout", "clearTimeout", "performance"] });
    XmaxLogger.configure(XmaxLoggerOption.none);
  });
  afterEach(() => {
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
    vi.useRealTimers();
    XmaxLogger.configure(XmaxLoggerOption.none);
  });

  it("reports presented frame deltas, zero when stalled, and keeps sampling a hidden statistics UI", async () => {
    const { view, video } = makeView();
    const listener = vi.fn();
    view.renderStatisticsHandler = listener;
    video.nextFrame(0, 100);
    video.nextFrame(0, 123);
    await vi.advanceTimersByTimeAsync(1000);
    expect(listener).toHaveBeenLastCalledWith({ source: "video", frameRate: 24, originalFrameRate: 24, interpolatedFrameRate: 0 });
    await vi.advanceTimersByTimeAsync(1000);
    expect(listener).toHaveBeenLastCalledWith(expect.objectContaining({ frameRate: 0 }));

    view.element.style.visibility = "hidden";
    video.nextFrame();
    await vi.advanceTimersByTimeAsync(1000);
    expect(listener).toHaveBeenLastCalledWith(expect.objectContaining({ frameRate: 1 }));
    view.detach();
    expect(listener).toHaveBeenLastCalledWith(undefined);
    expect(video.callbacks.size).toBe(0);
    expect(vi.getTimerCount()).toBe(0);
  });

  it("counts only presented canvas originals and midpoints, not source callbacks or idle vsyncs", async () => {
    const { view, video } = makeView();
    const listener = vi.fn();
    view.renderStatisticsHandler = listener;
    let slot = 0;
    vi.spyOn(FrameInterpolationManager, "create").mockResolvedValue({
      capture: () => slot++ % 3,
      interpolate: async () => 3,
      present: vi.fn(), destroy: vi.fn(),
    } as unknown as FrameInterpolationManager);
    let tick: FrameRequestCallback | undefined;
    vi.stubGlobal("requestAnimationFrame", (callback: FrameRequestCallback) => { tick = callback; return 1; });
    vi.stubGlobal("cancelAnimationFrame", () => { tick = undefined; });
    view.isVideoVisible = false;
    view.setFrameInterpolation({ size: { width: 320, height: 180 }, onFailure: vi.fn() });
    const layer = (view.element as unknown as ElementStub).children[0]!;
    expect(mediaLayer(view).children).toHaveLength(2);
    expect(mediaLayer(view).children[0]).toBe(video);
    video.nextFrame(0, 1);
    await vi.advanceTimersByTimeAsync(0);
    video.nextFrame(0.04, 2);
    await vi.advanceTimersByTimeAsync(40);
    video.nextFrame(0.08, 3);
    await vi.advanceTimersByTimeAsync(20);
    tick?.(performance.now());
    await vi.advanceTimersByTimeAsync(20);
    tick?.(performance.now());
    tick?.(performance.now());
    await vi.advanceTimersByTimeAsync(920);
    expect(listener).toHaveBeenLastCalledWith({ source: "canvas", frameRate: 3, originalFrameRate: 2, interpolatedFrameRate: 1 });
    expect(layer.style.opacity).toBe("0");
    view.isVideoVisible = true;
    expect(layer.style.opacity).toBe("1");

    view.setFrameInterpolation(undefined);
    video.nextFrame(0.12, 4);
    await vi.advanceTimersByTimeAsync(1000);
    expect(listener).toHaveBeenLastCalledWith({ source: "video", frameRate: 1, originalFrameRate: 1, interpolatedFrameRate: 0 });
    view.detach();
    expect(vi.getTimerCount()).toBe(0);
  });

  it("clears old samples on source changes and ignores queued callbacks after detach", async () => {
    const { view, video } = makeView();
    const listener = vi.fn();
    view.renderStatisticsHandler = listener;
    video.nextFrame();
    view.setMediaStream({} as MediaStream);
    await vi.advanceTimersByTimeAsync(1000);
    expect(listener).toHaveBeenLastCalledWith(expect.objectContaining({ frameRate: 0 }));
    const queued = [...video.callbacks.values()];
    view.detach();
    queued.forEach((callback) => callback());
    expect(video.callbacks.size).toBe(0);
    expect(vi.getTimerCount()).toBe(0);
    view.attach(new ElementStub() as unknown as HTMLElement);
    video.nextFrame();
    await vi.advanceTimersByTimeAsync(1000);
    expect(listener).toHaveBeenLastCalledWith(expect.objectContaining({ frameRate: 1 }));
    view.track = undefined;
    expect(listener).toHaveBeenLastCalledWith(undefined);
    expect(vi.getTimerCount()).toBe(0);
  });

  it("does not estimate unsupported frame callbacks from timers", () => {
    const { view } = makeView(false);
    const listener = vi.fn();
    view.renderStatisticsHandler = listener;
    expect(listener).toHaveBeenLastCalledWith(undefined);
    expect(vi.getTimerCount()).toBe(0);
    view.detach();
  });

  it("reports statistics without performance logs and isolates listener errors", async () => {
    XmaxLogger.configure(XmaxLoggerOption.performance);
    const log = vi.spyOn(console, "info").mockImplementation(() => {});
    const { view, video } = makeView();
    const listener = vi.fn(() => { throw new Error("consumer error"); });
    view.renderStatisticsHandler = listener;
    video.nextFrame();
    await vi.advanceTimersByTimeAsync(1000);
    expect(listener).toHaveBeenLastCalledWith({ source: "video", frameRate: 1, originalFrameRate: 1, interpolatedFrameRate: 0 });
    video.nextFrame();
    await vi.advanceTimersByTimeAsync(1000);
    expect(listener).toHaveBeenLastCalledWith({ source: "video", frameRate: 1, originalFrameRate: 1, interpolatedFrameRate: 0 });
    expect(log).not.toHaveBeenCalled();
    view.renderStatisticsHandler = undefined;
    expect(vi.getTimerCount()).toBe(0);
    video.nextFrame();
    await vi.advanceTimersByTimeAsync(1000);
    expect(log).not.toHaveBeenCalled();
    view.detach();
    expect(vi.getTimerCount()).toBe(0);
  });
});

describe("XmaxVideoView first frame", () => {
  afterEach(() => vi.unstubAllGlobals());

  it("支持帧回调时不把 playing 当成首帧，并同时保留视图与绑定回调", () => {
    const { video, onBindingFrame, onViewFrame } = makeView();
    video.dispatchEvent(new Event("playing"));
    expect(onBindingFrame).not.toHaveBeenCalled();
    expect(onViewFrame).not.toHaveBeenCalled();
    video.nextFrame();
    video.nextFrame();
    expect(onBindingFrame).toHaveBeenCalledTimes(1);
    expect(onViewFrame).toHaveBeenCalledTimes(1);
  });

  it("换流和清空后忽略已排队的旧首帧，新流可以重新通知", () => {
    const { view, video, onBindingFrame } = makeView();
    const oldFrame = [...video.callbacks.values()][0]!;
    view.setMediaStream({} as MediaStream);
    oldFrame();
    expect(onBindingFrame).not.toHaveBeenCalled();
    video.nextFrame();
    expect(onBindingFrame).toHaveBeenCalledTimes(1);

    view.setMediaStream({} as MediaStream);
    const pendingFrame = [...video.callbacks.values()][0]!;
    view.setMediaStream(null);
    expect(video.callbacks.size).toBe(0);
    pendingFrame();
    expect(onBindingFrame).toHaveBeenCalledTimes(1);
  });

  it("卸载取消待处理回调，重新挂载后继续等待首帧", () => {
    const { view, video, onBindingFrame } = makeView();
    const oldFrame = [...video.callbacks.values()][0]!;
    view.detach();
    expect(video.callbacks.size).toBe(0);
    oldFrame();
    expect(onBindingFrame).not.toHaveBeenCalled();
    view.attach(new ElementStub() as unknown as HTMLElement);
    expect(video.play).toHaveBeenCalledTimes(1);
    video.nextFrame();
    expect(onBindingFrame).toHaveBeenCalledTimes(1);
  });

  it("解绑轨道时不再通知该轨道的拥有者", () => {
    const { view, video, onBindingFrame } = makeView();
    const oldFrame = [...video.callbacks.values()][0]!;
    view.track = undefined;
    oldFrame();
    expect(video.callbacks.size).toBe(0);
    expect(video.srcObject).toBeNull();
    expect(onBindingFrame).not.toHaveBeenCalled();
  });

  it("旧浏览器通过 playing 回退，每条流只通知一次", () => {
    const { view, video, onBindingFrame, onViewFrame } = makeView(false);
    video.dispatchEvent(new Event("playing"));
    video.dispatchEvent(new Event("playing"));
    expect(onBindingFrame).toHaveBeenCalledTimes(1);
    expect(onViewFrame).toHaveBeenCalledTimes(1);
    view.setMediaStream({} as MediaStream);
    video.dispatchEvent(new Event("playing"));
    expect(onBindingFrame).toHaveBeenCalledTimes(2);
  });

  it("组合视图卸载时取消子视图回调，重新挂载恢复首帧通知和渐入", () => {
    const videos: VideoStub[] = [];
    vi.stubGlobal("document", {
      createElement: (tag: string) => {
        if (tag !== "video") return new ElementStub();
        const video = new VideoStub();
        videos.push(video);
        return video;
      },
    });
    const animate = vi.fn((callback: () => void) => { callback(); return 1; });
    vi.stubGlobal("requestAnimationFrame", animate);
    const localTrack = new RealtimeVideoTrack({ id: "local" });
    const remoteTrack = new RealtimeVideoTrack({ id: "remote" });
    const onFrame = vi.fn();
    for (const track of [localTrack, remoteTrack]) {
      VideoRenderRegistry.register(track, {
        attachHandler: (target) => target.setMediaStream({} as MediaStream),
        detachHandler: (target) => target.setMediaStream(null),
        frameDisplayHandler: onFrame,
      });
    }
    const view = new XmaxRealtimeVideoView({ localTrack, remoteTrack });
    const queued = videos.flatMap((video) => [...video.callbacks.values()]);
    view.detach();
    expect(videos.every((video) => video.callbacks.size === 0)).toBe(true);
    queued.forEach((callback) => callback());
    expect(onFrame).not.toHaveBeenCalled();
    view.attach(new ElementStub() as unknown as HTMLElement);
    videos.forEach((video) => video.nextFrame());
    expect(onFrame).toHaveBeenCalledTimes(2);
    expect(animate).toHaveBeenCalledTimes(1);
  });
});
