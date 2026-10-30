import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { XmaxRealtimeVideoView } from "../src/Render/Video/XmaxRealtimeVideoView";
import { RealtimeVideoTrack } from "../src/Service/Realtime/RealtimeVideoTrack";
import { XmaxError, XmaxErrorCode } from "../src/Foundation/Errors/XmaxError";

const effects = vi.hoisted(() => ({ instances: [] as any[] }));
vi.mock("../src/Render/Beauty/AgoraBeautyController", async importOriginal => {
  const original = await importOriginal<typeof import("../src/Render/Beauty/AgoraBeautyController")>();
  return {
    ...original,
    AgoraBeautyController: class {
      start = vi.fn(async () => {});
      update = vi.fn();
      dispose = vi.fn(async () => {});
      constructor(readonly emit: (track: MediaStreamTrack) => void, readonly fail: (error: XmaxError) => void) {
        effects.instances.push(this);
      }
    },
  };
});

class ElementStub extends EventTarget {
  style: Record<string, string> = {};
  appendChild = vi.fn();
  remove = vi.fn();
  srcObject: MediaStream | null = null;
  paused = true;
  readyState = 0;
}

class StreamStub {
  constructor(readonly tracks: MediaStreamTrack[]) {}
  getVideoTracks() { return this.tracks; }
}

function setup() {
  const view = new XmaxRealtimeVideoView();
  const input = { kind: "video", stop: vi.fn() } as unknown as MediaStreamTrack;
  const track = new RealtimeVideoTrack({ id: "result" });
  track.mediaStreamTrack = input;
  view.track = track;
  const original = view.videoElement.srcObject;
  return { view, input, track, original };
}

beforeEach(() => {
  effects.instances.length = 0;
  vi.stubGlobal("document", { createElement: () => new ElementStub() });
  vi.stubGlobal("MediaStream", StreamStub);
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("display-only beauty", () => {
  it("leaves playback unprocessed by default without creating a beauty controller", () => {
    const s = setup();
    expect(s.view.beautyOptions).toBeUndefined();
    expect(effects.instances).toHaveLength(0);
    expect((s.original as MediaStream).getVideoTracks()).toEqual([s.input]);
    s.view.detach();
    expect(s.input.stop).not.toHaveBeenCalled();
  });

  it("replaces only the displayed stream and restores the original when disabled", () => {
    const s = setup();
    s.view.beautyOptions = { smoothness: 0.4 };
    const effect = effects.instances[0];
    const output = { kind: "video" } as MediaStreamTrack;
    effect.emit(output);
    expect((s.view.videoElement.srcObject as MediaStream).getVideoTracks()).toEqual([output]);
    expect(s.track.mediaStreamTrack).toBe(s.input);
    s.view.beautyOptions = { smoothness: 0.8 };
    expect(effects.instances).toHaveLength(1);
    expect(effect.update).toHaveBeenCalledWith(expect.objectContaining({ smoothness: 0.8 }));
    s.view.beautyOptions = undefined;
    expect(s.view.videoElement.srcObject).toBe(s.original);
    expect(effect.dispose).toHaveBeenCalledOnce();
    expect(s.input.stop).not.toHaveBeenCalled();
    effect.emit(output);
    expect(s.view.videoElement.srcObject).toBe(s.original);
  });

  it("ignores old processing output after source replacement", () => {
    const s = setup();
    s.view.beautyOptions = {};
    const old = effects.instances[0];
    const next = new MediaStream([{ kind: "video" } as MediaStreamTrack]);
    s.view.setMediaStream(next);
    expect(old.dispose).toHaveBeenCalledOnce();
    expect(effects.instances).toHaveLength(2);
    old.emit({ kind: "video" } as MediaStreamTrack);
    expect(s.view.videoElement.srcObject).toBe(next);
    s.view.detach();
    expect(effects.instances[1].dispose).toHaveBeenCalledOnce();
  });

  it("restores video and reports failure without clearing the received track", () => {
    const s = setup();
    const error = new XmaxError(XmaxErrorCode.mediaError, "Beauty overloaded");
    const report = vi.fn();
    s.view.beautyErrorHandler = report;
    s.view.beautyOptions = {};
    const effect = effects.instances[0];
    effect.emit({ kind: "video" } as MediaStreamTrack);
    effect.fail(error);
    expect(report).toHaveBeenCalledWith(error);
    expect(s.view.beautyOptions).toBeUndefined();
    expect(s.view.videoElement.srcObject).toBe(s.original);
    expect(s.track.mediaStreamTrack).toBe(s.input);
    expect(s.input.stop).not.toHaveBeenCalled();
  });

  it("releases processing on detach and recreates it on reattachment", () => {
    const s = setup();
    s.view.beautyOptions = {};
    s.view.detach();
    expect(effects.instances[0].dispose).toHaveBeenCalledOnce();
    s.view.attach(new ElementStub() as unknown as HTMLElement);
    expect(effects.instances).toHaveLength(2);
    expect(s.input.stop).not.toHaveBeenCalled();
    s.view.detach();
  });
});
