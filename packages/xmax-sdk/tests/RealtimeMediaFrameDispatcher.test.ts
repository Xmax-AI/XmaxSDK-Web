import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { RealtimeMediaFrameDispatcher } from "../src/Render/Video/RealtimeMediaFrameDispatcher";
import type { RealtimeMediaFrame } from "../src/Service/Realtime/RealtimeMediaFrame";

function video(pts: number): RealtimeMediaFrame {
  const frame = { displayWidth: 2, displayHeight: 2, close: vi.fn() } as unknown as VideoFrame;
  return { streamID: "stream", isDiscontinuous: false, presentationTimeStamp: pts,
    content: { type: "video", frame: { frame, presentationTimeStamp: pts } } };
}

function audio(pts: number): RealtimeMediaFrame {
  return { streamID: "stream", isDiscontinuous: false, presentationTimeStamp: pts, duration: 20_000,
    content: { type: "audio", frame: { data: new Uint8Array(4), sampleRate: 48000,
      channels: 1, samplesPerChannel: 2, presentationTimeStamp: pts, duration: 2_000_000 / 48000 } } };
}

function closeSpy(packet: RealtimeMediaFrame) {
  if (packet.content.type !== "video") throw new Error("not video");
  return packet.content.frame.frame.close;
}

describe("RealtimeMediaFrameDispatcher", () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => { vi.useRealTimers(); vi.restoreAllMocks(); });

  it("preserves delivery order, timestamps and separate track discontinuities", async () => {
    const queue = new RealtimeMediaFrameDispatcher();
    const listener = vi.fn();
    queue.setListener(listener);
    const first = video(2_000_000);
    queue.dispatch(first);
    queue.dispatch(audio(1_980_000));
    queue.dispatch(video(2_033_333));
    queue.dispatch(audio(2_000_000));
    expect(listener).not.toHaveBeenCalled();
    await vi.runAllTimersAsync();
    const packets = listener.mock.calls.map(call => call[0]);
    expect(packets.map(packet => packet.presentationTimeStamp)).toEqual([2_000_000, 1_980_000, 2_033_333, 2_000_000]);
    expect(packets.map(packet => packet.isDiscontinuous)).toEqual([true, true, false, false]);
    expect(Object.isFrozen(packets[0])).toBe(true);
    expect(closeSpy(first)).not.toHaveBeenCalled();
    queue.setListener(undefined);
    expect(closeSpy(first)).not.toHaveBeenCalled();
  });

  it.each(["count", "bytes"])("bounds pending %s and closes dropped frames without trimming time", async limit => {
    const queue = new RealtimeMediaFrameDispatcher(limit === "count" ? 1 : 256, limit === "bytes" ? 16 : 1024);
    const listener = vi.fn();
    queue.setListener(listener);
    queue.dispatch(video(0));
    const dropped = video(33_333);
    queue.dispatch(dropped);
    expect(closeSpy(dropped)).toHaveBeenCalledOnce();
    await vi.runAllTimersAsync();
    queue.dispatch(video(2_000_000));
    await vi.runAllTimersAsync();
    expect(listener.mock.calls.at(-1)![0]).toMatchObject({ presentationTimeStamp: 2_000_000, isDiscontinuous: true });
  });

  it("drops only the affected track's continuity", async () => {
    const queue = new RealtimeMediaFrameDispatcher(1);
    const listener = vi.fn();
    queue.setListener(listener);
    queue.dispatch(audio(0));
    await vi.runAllTimersAsync();
    queue.dispatch(video(0));
    queue.dispatch(video(100));
    await vi.runAllTimersAsync();
    queue.dispatch(audio(20_000));
    await vi.runAllTimersAsync();
    expect(listener.mock.calls.at(-1)![0].isDiscontinuous).toBe(false);
  });

  it("cancels queued work on listener replacement, removal and stream reset", async () => {
    const queue = new RealtimeMediaFrameDispatcher();
    const old = vi.fn(), next = vi.fn();
    queue.setListener(old);
    const stale = video(0);
    queue.dispatch(stale);
    queue.setListener(next);
    expect(closeSpy(stale)).toHaveBeenCalledOnce();
    await vi.runAllTimersAsync();
    expect(old).not.toHaveBeenCalled();
    queue.dispatch(audio(20_000));
    queue.reset();
    queue.dispatch(audio(40_000));
    await vi.runAllTimersAsync();
    expect(next).toHaveBeenLastCalledWith(expect.objectContaining({ isDiscontinuous: true, presentationTimeStamp: 40_000 }));
    const cancelled = video(50_000);
    queue.dispatch(cancelled);
    queue.setListener(undefined);
    expect(closeSpy(cancelled)).toHaveBeenCalledOnce();
    expect(vi.getTimerCount()).toBe(0);
  });

  it("stops calling a listener that removes itself during delivery", async () => {
    const queue = new RealtimeMediaFrameDispatcher();
    const listener = vi.fn(() => queue.setListener(undefined));
    queue.setListener(listener);
    queue.dispatch(audio(0));
    const pending = video(0);
    queue.dispatch(pending);
    await vi.runAllTimersAsync();
    expect(listener).toHaveBeenCalledOnce();
    expect(closeSpy(pending)).toHaveBeenCalledOnce();
  });

  it.each([false, true])("isolates observer exceptions and releases rejected video (async=%s)", async asynchronous => {
    const queue = new RealtimeMediaFrameDispatcher();
    const fail = () => { throw new Error("consumer failed"); };
    queue.setListener(asynchronous ? async () => fail() : fail);
    const frame = video(0);
    queue.dispatch(frame);
    await vi.runAllTimersAsync();
    expect(closeSpy(frame)).toHaveBeenCalledOnce();
    queue.setListener(undefined);
    expect(vi.getTimerCount()).toBe(0);
  });
});
