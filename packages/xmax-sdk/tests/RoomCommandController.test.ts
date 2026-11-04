import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { XmaxError, XmaxErrorCode } from "../src/Foundation/Errors/XmaxError";
import { RoomCommandController, type RoomCommandKind, type RoomCommandRelay } from "../src/Stream/Room/RoomCommandController";
import { XmaxLogger, XmaxLoggerOption } from "../src/Foundation/Logging/XmaxLogger";

function setup(relay?: RoomCommandRelay) {
  let sequence = 0;
  const sends: Array<{ message: string; signal: AbortSignal; time: number }> = [];
  const send = vi.fn(async (message: string, signal: AbortSignal) => {
    sends.push({ message, signal, time: Date.now() });
  });
  const controller = new RoomCommandController(send, () => `xid-${++sequence}`, relay);
  const command = (kind: RoomCommandKind = "start", taskID = "task", value = "a") => controller.send(
    kind, taskID, xid => JSON.stringify({ event: kind, xid, uid: taskID, params: { prompt: value } }),
  );
  const ack = (xid = "xid-1", count = 1) => controller.acknowledge({ event: "xid_ack", xid, count });
  return { controller, sends, send, command, ack };
}

const flush = () => vi.advanceTimersByTimeAsync(0);

describe("RoomCommandController", () => {
  beforeEach(() => { vi.useFakeTimers(); vi.setSystemTime(0); });
  afterEach(() => { XmaxLogger.configure(XmaxLoggerOption.none); vi.restoreAllMocks(); vi.clearAllTimers(); vi.useRealTimers(); });

  it.each(["start", "change_condition", "change_target_size"] as const)("completes %s before ACK and repeats in the background without failing at six seconds", async kind => {
    const s = setup();
    const warning = vi.spyOn(console, "warn").mockImplementation(() => {});
    XmaxLogger.configure(XmaxLoggerOption.business);
    await s.command(kind);
    expect(s.send).toHaveBeenCalledOnce();
    await vi.advanceTimersByTimeAsync(5_999);
    expect(s.sends.map(x => x.time)).toEqual([0, 300, 1000, 3000, 3300, 4000]);
    expect(new Set(s.sends.map(x => x.message)).size).toBe(1);
    expect(warning).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(1);
    expect(warning).toHaveBeenCalledOnce();
    expect(warning.mock.calls[0]!.join(" ")).toContain("retries stopped");
    expect(s.sends.every(x => x.signal.aborted)).toBe(true);
    expect(vi.getTimerCount()).toBe(0);
    await vi.advanceTimersByTimeAsync(6000);
    expect(s.sends).toHaveLength(6);
  });

  it.each([1, 2, 9])("stops remaining redundant sends on a matching ACK with count=%s", async count => {
    const s = setup();
    await s.command();
    await vi.advanceTimersByTimeAsync(300);
    s.ack("xid-1", count);
    await vi.advanceTimersByTimeAsync(10_000);
    expect(s.sends).toHaveLength(2);
    expect(vi.getTimerCount()).toBe(0);
  });

  it("does not use even an early ACK as the result of the original transport call", async () => {
    const s = setup();
    let finish!: () => void;
    s.send.mockImplementationOnce(() => {
      s.ack();
      return new Promise<void>(resolve => { finish = resolve; });
    });
    const done = vi.fn();
    const sending = s.command().then(done);
    await flush();
    expect(done).not.toHaveBeenCalled();
    expect(vi.getTimerCount()).toBe(0);
    finish();
    await sending;
    expect(done).toHaveBeenCalledOnce();
  });

  it("does not manufacture a send failure from an ACK timeout while the original transport is pending", async () => {
    const s = setup();
    let finish!: () => void;
    const signals: AbortSignal[] = [];
    s.send.mockImplementation((_message, signal) => {
      signals.push(signal);
      return new Promise<void>(resolve => { if (signals.length === 1) finish = resolve; });
    });
    const done = vi.fn();
    const failed = vi.fn();
    const sending = s.command().then(done, failed);
    await vi.advanceTimersByTimeAsync(6000);
    expect(s.send).toHaveBeenCalledTimes(6);
    expect(done).not.toHaveBeenCalled();
    expect(failed).not.toHaveBeenCalled();
    expect(signals[0]!.aborted).toBe(false);
    expect(signals.slice(1).every(signal => signal.aborted)).toBe(true);
    finish();
    await sending;
    expect(done).toHaveBeenCalledOnce();
    expect(signals[0]!.aborted).toBe(true);
  });

  it("lets condition and dimension updates follow the initial send without any start ACK", async () => {
    const s = setup();
    await s.command();
    await s.command("change_condition");
    await s.command("change_target_size");
    expect(s.sends.map(x => JSON.parse(x.message).event)).toEqual(["start", "change_condition", "change_target_size"]);
    s.ack();
    s.ack("xid-2");
    s.ack("xid-3");
    expect(vi.getTimerCount()).toBe(0);
  });

  it("ignores malformed and unrelated ACKs and matches separate background commands by xid", async () => {
    const s = setup();
    await s.command();
    await s.command("change_condition");
    for (const count of [undefined, "1", 0, -1, 0.5, NaN]) {
      s.controller.acknowledge({ event: "xid_ack", xid: "xid-1", count });
    }
    s.ack("other-client");
    s.controller.acknowledge({ event: "other", xid: "xid-1", count: 1 });
    expect(vi.getTimerCount()).toBe(12);
    s.ack("xid-2");
    expect(vi.getTimerCount()).toBe(6);
    s.ack();
    s.ack();
    expect(vi.getTimerCount()).toBe(0);
  });

  it("retains only the newest queued condition while preserving initial start ordering", async () => {
    const s = setup();
    let finish!: () => void;
    s.send.mockImplementationOnce(async (message, signal) => {
      s.sends.push({ message, signal, time: Date.now() });
      await new Promise<void>(resolve => { finish = resolve; });
    });
    const start = s.command();
    await flush();
    const old = s.command("change_condition", "task", "b");
    const rejected = expect(old).rejects.toMatchObject({ code: XmaxErrorCode.cancelled });
    const latest = s.command("change_condition", "task", "c");
    await rejected;
    expect(s.send).toHaveBeenCalledOnce();
    finish();
    await Promise.all([start, latest]);
    expect(s.sends.map(x => JSON.parse(x.message).event)).toEqual(["start", "change_condition"]);
    expect(JSON.parse(s.sends.at(-1)!.message).params.prompt).toBe("c");
    s.controller.cancel();
  });

  it("supersedes old update retries without rejecting a send that already completed", async () => {
    const s = setup();
    await s.command("change_condition");
    await s.command("change_condition", "task", "new");
    expect(s.sends[0]!.signal.aborted).toBe(true);
    await vi.advanceTimersByTimeAsync(300);
    expect(s.sends.filter(x => JSON.parse(x.message).xid === "xid-1")).toHaveLength(1);
    expect(s.sends.filter(x => JSON.parse(x.message).xid === "xid-2")).toHaveLength(2);
    s.controller.cancel();
  });

  it("cancels all old-task retry schedules before sending a replacement start", async () => {
    const s = setup();
    await s.command();
    await s.command("change_target_size");
    await s.command("start", "new-task");
    s.ack("xid-1");
    await vi.advanceTimersByTimeAsync(300);
    expect(s.sends.map(x => JSON.parse(x.message).xid)).toEqual(["xid-1", "xid-2", "xid-3", "xid-3"]);
    s.ack("xid-3");
    expect(vi.getTimerCount()).toBe(0);
  });

  it("does not suppress later commands when the start retry budget expires", async () => {
    const s = setup();
    await s.command();
    await vi.advanceTimersByTimeAsync(6000);
    await s.command("change_condition");
    expect(JSON.parse(s.sends.at(-1)!.message).event).toBe("change_condition");
    s.controller.cancel();
  });

  it("retains a frozen payload across retries and creates a new xid for another identical operation", async () => {
    const s = setup();
    const params = { prompt: "before" };
    await s.controller.send("change_condition", "task", xid => JSON.stringify({ event: "change_condition", xid, params }));
    params.prompt = "after";
    await vi.advanceTimersByTimeAsync(300);
    expect(s.sends.every(x => JSON.parse(x.message).params.prompt === "before")).toBe(true);
    await s.command("change_condition");
    expect(JSON.parse(s.sends.at(-1)!.message).xid).toBe("xid-2");
    s.controller.cancel();
  });

  it("still rejects an initial transport failure and cancels its background schedule", async () => {
    const s = setup();
    s.send.mockRejectedValueOnce(new XmaxError(XmaxErrorCode.rtcError, "native send failed"));
    await expect(s.command()).rejects.toThrow("native send failed");
    await vi.advanceTimersByTimeAsync(6000);
    expect(s.send).toHaveBeenCalledOnce();
    expect(vi.getTimerCount()).toBe(0);
  });

  it("does not fail an active task when a later redundant send rejects", async () => {
    const s = setup();
    await s.command();
    s.send.mockRejectedValue(new XmaxError(XmaxErrorCode.rtcError, "retry send failed"));
    await vi.advanceTimersByTimeAsync(6000);
    expect(s.send).toHaveBeenCalledTimes(6);
    expect(vi.getTimerCount()).toBe(0);
  });

  it("cancels an unresolved original send on task exit even after its retry budget ended", async () => {
    const s = setup();
    s.send.mockImplementation(() => new Promise(() => {}));
    const sending = s.command();
    const rejected = expect(sending).rejects.toMatchObject({ code: XmaxErrorCode.cancelled });
    await vi.advanceTimersByTimeAsync(6000);
    s.controller.cancel();
    await rejected;
    expect(vi.getTimerCount()).toBe(0);
  });

  it.each(["start", "change_condition", "change_target_size"] as const)("relays %s once with the original payload while RTC retries six times", async kind => {
    const relay = vi.fn(async (_message: string, _signal: AbortSignal) => {});
    const s = setup(relay);
    await s.command(kind);
    expect(relay).toHaveBeenCalledWith(s.sends[0]!.message, expect.any(AbortSignal));
    await vi.advanceTimersByTimeAsync(6000);
    expect(s.send).toHaveBeenCalledTimes(6);
    expect(relay).toHaveBeenCalledOnce();
  });

  it("continues later controls without waiting for the HTTP submissions or ACKs", async () => {
    const relay = vi.fn(() => new Promise<void>(() => {}));
    const s = setup(relay);
    await s.command();
    await s.command("change_condition");
    await s.command("change_target_size");
    expect(s.send).toHaveBeenCalledTimes(3);
    expect(relay).toHaveBeenCalledTimes(3);
    s.controller.cancel();
  });

  it.each([false, true])("logs HTTP failure once without failing or retrying the command, synchronous=%s", async synchronous => {
    const warning = vi.spyOn(console, "warn").mockImplementation(() => {});
    XmaxLogger.configure(XmaxLoggerOption.business);
    const error = new XmaxError(XmaxErrorCode.apiError, "relay unavailable", { httpStatus: 503 });
    const relay = vi.fn(() => {
      if (synchronous) {
        throw error;
      }
      return Promise.reject(error);
    });
    const s = setup(relay);
    await expect(s.command()).resolves.toBeUndefined();
    s.ack();
    await vi.advanceTimersByTimeAsync(10_000);
    expect(relay).toHaveBeenCalledOnce();
    expect(warning).toHaveBeenCalledOnce();
    expect(warning.mock.calls.flat().join(" ")).toContain("relay unavailable");
    expect(warning.mock.calls.flat().join(" ")).toContain("httpStatus: 503");
    expect(vi.getTimerCount()).toBe(0);
  });

  it.each(["ack", "deadline"] as const)("keeps HTTP cancellable on task exit after RTC %s", async boundary => {
    const relay = vi.fn((_message: string, _signal: AbortSignal) => new Promise<void>(() => {}));
    const s = setup(relay);
    await s.command();
    const signal = relay.mock.calls[0]![1];
    if (boundary === "ack") {
      s.ack();
    } else {
      await vi.advanceTimersByTimeAsync(6000);
    }
    expect(signal.aborted).toBe(false);
    s.controller.cancel("task");
    expect(signal.aborted).toBe(true);
    expect(vi.getTimerCount()).toBe(0);
  });

  it("cancels acknowledged old HTTP updates on supersession while preserving independent controls", async () => {
    const relay = vi.fn((_message: string, _signal: AbortSignal) => new Promise<void>(() => {}));
    const s = setup(relay);
    await s.command("change_condition");
    s.ack();
    await s.command("change_target_size");
    await s.command("change_condition", "task", "new prompt");
    expect(relay.mock.calls.map(([, signal]) => signal.aborted)).toEqual([true, false, false]);
    await s.command("start", "replacement-task");
    expect(relay.mock.calls.map(([, signal]) => signal.aborted)).toEqual([true, true, true, false]);
    s.controller.cancel();
  });

  it("does not report lifecycle cancellation as an HTTP failure", async () => {
    const warning = vi.spyOn(console, "warn").mockImplementation(() => {});
    XmaxLogger.configure(XmaxLoggerOption.business);
    const relay = vi.fn((_message: string, signal: AbortSignal) => new Promise<void>((_resolve, reject) => {
      signal.addEventListener("abort", () => reject(new DOMException("Cancelled", "AbortError")), { once: true });
    }));
    const s = setup(relay);
    await s.command();
    s.ack();
    s.controller.cancel();
    await flush();
    expect(warning).not.toHaveBeenCalled();
    expect(vi.getTimerCount()).toBe(0);
  });

  it("retains the initial RTC failure result and cancels its pending HTTP copy", async () => {
    const relay = vi.fn((_message: string, _signal: AbortSignal) => new Promise<void>(() => {}));
    const s = setup(relay);
    s.send.mockRejectedValueOnce(new XmaxError(XmaxErrorCode.rtcError, "RTC send failed"));
    await expect(s.command()).rejects.toThrow("RTC send failed");
    expect(relay).toHaveBeenCalledOnce();
    expect(relay.mock.calls[0]![1].aborted).toBe(true);
    expect(vi.getTimerCount()).toBe(0);
  });

});
