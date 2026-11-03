import { describe, expect, it, vi } from "vitest";
import { RemoteVideoOutputController } from "../src/Render/Video/RemoteVideoOutputController";
import type { StableVideoOutput } from "../src/Render/Video/StableVideoOutput";
import type { AgoraBeautyController } from "../src/Render/Beauty/AgoraBeautyController";
import { XmaxError, XmaxErrorCode } from "../src/Foundation/Errors/XmaxError";
import { resolvedVideoBeautyOptions } from "../src/Service/Realtime/RealtimeVideoBeautyOptions";

function track() {
  return Object.assign(new EventTarget(), { kind: "video", stop: vi.fn(), readyState: "live" }) as unknown as MediaStreamTrack;
}

function setup(start?: () => Promise<void>) {
  const bridges: any[] = [], effects: any[] = [];
  const display = vi.fn(), receive = vi.fn(), errors = vi.fn();
  const input = track(), stable = track(), processed = track(), audio = track();
  const source = { bindingID: "task-1", userID: "bot", videoTrack: input, audioTrack: audio };
  const output = new RemoteVideoOutputController(display, (emit, fail) => {
    const bridge = { setSource: vi.fn(), dispose: vi.fn(), emit: (value = stable) => emit(value), fail };
    bridges.push(bridge);
    return bridge as unknown as StableVideoOutput;
  }, (emit, fail) => {
    const effect = { start: vi.fn(async () => { await start?.(); emit(processed); }), update: vi.fn(), dispose: vi.fn(async () => {}), emit, fail };
    effects.push(effect);
    return effect as unknown as AgoraBeautyController;
  });
  output.setBeautyErrorListener(errors);
  return { output, bridges, effects, display, receive, errors, input, stable, processed, audio, source };
}

describe("shared result beauty", () => {
  it("rejects explicit processor initialization errors without a duplicate runtime error", async () => {
    const s = setup(async () => { throw new Error("processor unavailable"); });
    s.output.setSource(s.source);
    s.output.setListener(s.receive);
    s.bridges[0].emit();
    await expect(s.output.setBeauty({ smoothness: 0.5 })).rejects.toThrow("processor unavailable");
    expect(s.errors).not.toHaveBeenCalled();
    expect(s.bridges[0].setSource).toHaveBeenLastCalledWith(s.input);
    expect(s.receive).toHaveBeenLastCalledWith({ ...s.source, videoTrack: s.stable });
    await s.output.close();
  });

  it("retains the latest configuration while processing initializes", async () => {
    let finish!: () => void;
    const s = setup(() => new Promise<void>(resolve => { finish = resolve; }));
    s.output.setSource(s.source);
    const first = s.output.setBeauty({ smoothness: 0.3 });
    const second = s.output.setBeauty({ smoothness: 0.8 });
    expect(s.effects).toHaveLength(1);
    expect(s.effects[0].update).toHaveBeenCalledWith(expect.objectContaining({ smoothness: 0.8 }));
    finish();
    await Promise.all([first, second]);
    await s.output.close();
  });

  it("cancels old configuration without disabling a newer effect", async () => {
    const pending: Array<() => void> = [];
    const s = setup(() => new Promise<void>(resolve => { pending.push(resolve); }));
    s.output.setSource(s.source);
    const first = s.output.setBeauty({ smoothness: 0.3 });
    const rejected = expect(first).rejects.toMatchObject({ code: "CANCELLED" });
    await s.output.setBeauty(undefined);
    const second = s.output.setBeauty({ smoothness: 0.8 });
    pending[0]!();
    await rejected;
    pending[1]!();
    await second;
    expect(s.effects[1].dispose).not.toHaveBeenCalled();
    expect(s.errors).not.toHaveBeenCalled();
    await s.output.close();
  });

  it("awaits obsolete processor cleanup before close completes", async () => {
    const s = setup();
    s.output.setSource(s.source);
    await s.output.setBeauty({ smoothness: 0.5 });
    let release!: () => void;
    s.effects[0].dispose.mockImplementation(() => new Promise<void>(resolve => { release = resolve; }));
    s.output.setVideoTrack(undefined);
    let closed = false;
    const closing = s.output.close().then(() => { closed = true; });
    await Promise.resolve();
    expect(closed).toBe(false);
    release();
    await closing;
    expect(closed).toBe(true);
    expect(s.input.stop).not.toHaveBeenCalled();
  });

  it("releases output on source end and retains configuration across reconnect", async () => {
    const s = setup();
    await s.output.setBeauty({ smoothness: 0.5 });
    s.output.setSource(s.source);
    s.output.setListener(s.receive);
    s.bridges[0].emit();
    s.input.dispatchEvent(new Event("ended"));
    expect(s.receive).toHaveBeenLastCalledWith(undefined);
    expect(s.bridges[0].dispose).toHaveBeenCalledOnce();
    s.output.setSource({ ...s.source, videoTrack: track() });
    expect(s.effects).toHaveLength(2);
    await s.output.close();
  });

  it("keeps the disabled, unobserved path native and does not load processing", () => {
    const s = setup();
    s.output.setVideoTrack(s.input);
    expect(s.display).toHaveBeenLastCalledWith(s.input);
    expect(s.bridges).toHaveLength(0);
    expect(s.effects).toHaveLength(0);
  });

  it("creates stable media before notifying recorders, sharing preview pixels and original audio", async () => {
    const s = setup();
    s.output.setSource(s.source);
    s.output.setListener(s.receive);
    expect(s.receive).toHaveBeenLastCalledWith(undefined);
    s.bridges[0].emit();
    const result = { ...s.source, videoTrack: s.stable };
    expect(s.display).toHaveBeenLastCalledWith(s.stable);
    expect(s.receive).toHaveBeenLastCalledWith(result);
    await s.output.setBeauty({ smoothness: 0.4 });
    expect(s.bridges[0].setSource).toHaveBeenLastCalledWith(s.processed);
    await s.output.setBeauty(undefined);
    expect(s.bridges[0].setSource).toHaveBeenLastCalledWith(s.input);
    expect(s.effects[0].dispose).toHaveBeenCalledOnce();
    expect(s.receive).toHaveBeenLastCalledWith(result);
    expect(s.stable.stop).not.toHaveBeenCalled();
    expect(s.input.stop).not.toHaveBeenCalled();
    expect(s.audio.stop).not.toHaveBeenCalled();
    await s.output.close();
  });

  it("stores configuration before connection and creates only one processor for all consumers", async () => {
    const s = setup();
    await s.output.setBeauty({ sharpness: 0.2 });
    expect(s.effects).toHaveLength(0);
    s.output.setSource(s.source);
    s.output.setListener(s.receive);
    s.bridges[0].emit();
    await s.output.setBeauty({ sharpness: 0.7 });
    expect(s.effects).toHaveLength(1);
    expect(s.effects[0].update).toHaveBeenLastCalledWith({ smoothness: 0, lightening: 0, sharpness: 0.7, redness: 0 });
    expect(s.bridges).toHaveLength(1);
    await s.output.close();
  });

  it("treats all-zero options as unchanged pixels without loading the extension", async () => {
    const s = setup();
    s.output.setSource(s.source);
    await s.output.setBeauty({});
    expect(s.effects).toHaveLength(0);
    expect(resolvedVideoBeautyOptions({})).toEqual({ smoothness: 0, lightening: 0, sharpness: 0, redness: 0 });
    await s.output.close();
  });

  it.each([-1, 1.1, NaN, Infinity])("rejects invalid options before changing an active effect: %s", async smoothness => {
    const s = setup();
    s.output.setSource(s.source);
    await s.output.setBeauty({ smoothness: 0.5 });
    await expect(s.output.setBeauty({ smoothness })).rejects.toMatchObject({ code: "INVALID_CONFIGURATION" });
    expect(s.effects[0].dispose).not.toHaveBeenCalled();
    expect(s.effects[0].update).not.toHaveBeenCalled();
    expect(s.errors).not.toHaveBeenCalled();
    await s.output.close();
  });

  it("restores raw pixels on overload without replacing the recording track", async () => {
    const s = setup();
    s.output.setSource(s.source);
    s.output.setListener(s.receive);
    s.bridges[0].emit();
    await s.output.setBeauty({ lightening: 0.6 });
    const error = new XmaxError(XmaxErrorCode.mediaError, "overloaded");
    s.effects[0].fail(error);
    expect(s.errors).toHaveBeenCalledOnce();
    expect(s.errors).toHaveBeenCalledWith(error);
    expect(s.bridges[0].setSource).toHaveBeenLastCalledWith(s.input);
    expect(s.receive).toHaveBeenLastCalledWith({ ...s.source, videoTrack: s.stable });
    expect(s.bridges[0].dispose).not.toHaveBeenCalled();
    await s.output.close();
  });

  it("preserves task identity and output on late or replaced audio", async () => {
    const s = setup();
    s.output.setListener(s.receive);
    s.output.setSource({ ...s.source, audioTrack: undefined });
    s.bridges[0].emit();
    s.output.setSource(s.source);
    expect(s.receive).toHaveBeenLastCalledWith({ ...s.source, videoTrack: s.stable });
    expect(s.bridges).toHaveLength(1);
    expect(s.input.stop).not.toHaveBeenCalled();
    await s.output.close();
  });

  it("discards obsolete effect and canvas output after source replacement", async () => {
    const s = setup();
    s.output.setSource(s.source);
    s.output.setListener(s.receive);
    s.bridges[0].emit();
    await s.output.setBeauty({ redness: 0.4 });
    const next = track();
    s.output.setSource({ ...s.source, bindingID: "task-2", videoTrack: next });
    const current = track();
    s.bridges[1].emit(current);
    s.bridges[0].emit(s.stable);
    s.effects[0].emit(s.processed);
    s.effects[0].fail(new Error("stale"));
    expect(s.receive).toHaveBeenLastCalledWith({ ...s.source, bindingID: "task-2", videoTrack: current });
    expect(s.bridges[0].dispose).toHaveBeenCalledOnce();
    expect(s.errors).not.toHaveBeenCalled();
    expect(next.stop).not.toHaveBeenCalled();
    await s.output.close();
  });

  it("clears options and error listeners on close while retaining borrowed tracks", async () => {
    const s = setup();
    await s.output.setBeauty({ sharpness: 0.4 });
    s.output.setSource(s.source);
    s.output.setListener(s.receive);
    s.bridges[0].emit();
    await s.output.close();
    expect(s.bridges[0].dispose).toHaveBeenCalledOnce();
    s.output.setSource(s.source);
    expect(s.effects).toHaveLength(1);
    expect(s.bridges).toHaveLength(1);
    expect(s.input.stop).not.toHaveBeenCalled();
    expect(s.audio.stop).not.toHaveBeenCalled();
    await s.output.close();
  });

  it("keeps direct output when the browser cannot provide a stable canvas track", async () => {
    const errors = vi.fn(), display = vi.fn(), receive = vi.fn();
    const input = track();
    const output = new RemoteVideoOutputController(display, () => { throw new Error("unsupported canvas"); });
    output.setBeautyErrorListener(errors);
    output.setSource({ bindingID: "task", userID: "bot", videoTrack: input });
    output.setListener(receive);
    expect(receive).toHaveBeenLastCalledWith({ bindingID: "task", userID: "bot", videoTrack: input });
    await expect(output.setBeauty({ smoothness: 0.5 })).rejects.toThrow("unavailable");
    expect(errors).not.toHaveBeenCalled();
    expect(display).toHaveBeenLastCalledWith(input);
    await output.close();
  });
});
