import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { RemoteRecorder } from "../src/recording/RemoteRecorder";
import type { RealtimeMediaFrame, RealtimeMediaFrameListener } from "@xmaxai/web-sdk";
import type { RecordingRequest, RecordingResponse } from "../src/recording/recordingMessages";

function setup() {
  let listener: RealtimeMediaFrameListener | undefined;
  const worker = {
    onmessage: undefined as ((event: MessageEvent<RecordingResponse>) => void) | undefined,
    onerror: undefined as ((event: { message: string }) => void) | undefined,
    postMessage: vi.fn((_request: RecordingRequest, _transfer?: Transferable[]) => {}),
    terminate: vi.fn(),
  };
  const realtime = { setRemoteMediaFrameListener: vi.fn(async (next?: RealtimeMediaFrameListener) => { listener = next; }) };
  const error = vi.fn(), ended = vi.fn();
  const recorder = new RemoteRecorder(realtime, error, ended, () => worker as unknown as Worker);
  const send = (data: RecordingResponse) => worker.onmessage!({ data } as MessageEvent<RecordingResponse>);
  const emit = (packet: RealtimeMediaFrame) => listener!(packet);
  const start = async () => {
    const pending = recorder.start();
    send({ type: "ready" });
    await pending;
  };
  return { recorder, worker, realtime, error, ended, send, emit, start };
}

function video(streamID = "stream", width = 320): RealtimeMediaFrame {
  const frame = { displayWidth: width, displayHeight: 180, close: vi.fn() } as unknown as VideoFrame;
  return { streamID, isDiscontinuous: false, presentationTimeStamp: 5_000_000,
    content: { type: "video", frame: { frame, presentationTimeStamp: 5_000_000 } } };
}

describe("XLab remote recorder", () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => { vi.useRealTimers(); vi.restoreAllMocks(); });

  it("unlocks the SDK listener before awaiting the worker, transferring owned video and PCM", async () => {
    const s = setup();
    const started = s.recorder.start();
    expect(s.realtime.setRemoteMediaFrameListener).toHaveBeenCalledOnce();
    const early = video();
    s.emit(early);
    if (early.content.type === "video") expect(early.content.frame.frame.close).toHaveBeenCalledOnce();
    s.send({ type: "ready" });
    await started;
    const packet = video();
    s.emit(packet);
    expect(s.worker.postMessage).toHaveBeenLastCalledWith({ type: "frame", id: 1, packet }, [packet.content.frame.frame]);
    const data = new Uint8Array(1920);
    const audio: RealtimeMediaFrame = { streamID: "stream", isDiscontinuous: false, presentationTimeStamp: 4_990_000,
      content: { type: "audio", frame: { data, channels: 1, sampleRate: 48000, samplesPerChannel: 960,
        presentationTimeStamp: 4_990_000, duration: 20_000 } } };
    s.emit(audio);
    expect(s.worker.postMessage).toHaveBeenLastCalledWith({ type: "frame", id: 2, packet: audio }, [data.buffer]);
    await s.recorder.dispose();
  });

  it("stops once, drains the worker, and releases the listener without stopping the session", async () => {
    const s = setup();
    await s.start();
    const stopped = s.recorder.stop();
    expect(s.recorder.stop()).toBe(stopped);
    await Promise.resolve();
    await Promise.resolve();
    expect(s.worker.postMessage).toHaveBeenLastCalledWith({ type: "stop" }, []);
    s.send({ type: "complete", blob: new Blob(["video"], { type: "video/mp4" }), extension: "mp4" });
    const result = await stopped;
    expect(result.fileName).toMatch(/^xmax-recording-.*\.mp4$/);
    expect(result.blob.size).toBe(5);
    expect(s.realtime.setRemoteMediaFrameListener).toHaveBeenLastCalledWith(undefined);
    expect(s.worker.terminate).toHaveBeenCalledOnce();
    expect(vi.getTimerCount()).toBe(0);
  });

  it("finishes instead of mixing different result streams", async () => {
    const s = setup();
    await s.start();
    s.emit(video());
    const changed = video("another-task");
    s.emit(changed);
    expect(s.ended).toHaveBeenCalledOnce();
    if (changed.content.type === "video") expect(changed.content.frame.frame.close).toHaveBeenCalledOnce();
    expect(s.worker.postMessage.mock.calls.filter(([message]) => message.type === "frame")).toHaveLength(1);
    await s.recorder.dispose();
  });

  it("bounds pending frames, returning encoder acknowledgements to the budget", async () => {
    const s = setup();
    await s.start();
    s.emit(video("stream", 40000));
    s.send({ type: "accepted", id: 1 });
    s.emit(video("stream", 40000));
    expect(s.error).not.toHaveBeenCalled();
    const overflow = video("stream", 40000);
    s.emit(overflow);
    if (overflow.content.type === "video") expect(overflow.content.frame.frame.close).toHaveBeenCalledOnce();
    expect(s.error).toHaveBeenCalledWith(expect.objectContaining({ message: expect.stringContaining("跟不上") }));
    expect(s.worker.terminate).toHaveBeenCalledOnce();
    await s.recorder.dispose();
  });

  it("cleans up SDK preparation failures and timeouts", async () => {
    const s = setup();
    s.realtime.setRemoteMediaFrameListener.mockRejectedValueOnce(new Error("no PCM support"));
    await expect(s.recorder.start()).rejects.toThrow("no PCM support");
    expect(s.worker.terminate).toHaveBeenCalledOnce();
    expect(vi.getTimerCount()).toBe(0);

    const timed = setup();
    const rejected = expect(timed.recorder.start()).rejects.toThrow("初始化超时");
    await vi.advanceTimersByTimeAsync(10_000);
    await rejected;
    expect(timed.worker.terminate).toHaveBeenCalledOnce();
  });

  it("surfaces worker failures and closes video when transfer fails", async () => {
    const s = setup();
    await s.start();
    s.worker.postMessage.mockImplementationOnce(() => { throw new Error("transfer failed"); });
    const packet = video();
    s.emit(packet);
    if (packet.content.type === "video") expect(packet.content.frame.frame.close).toHaveBeenCalledOnce();
    expect(s.error).toHaveBeenCalledWith(expect.objectContaining({ message: "transfer failed" }));
    expect(s.worker.terminate).toHaveBeenCalledOnce();
  });

  it("requests normal completion at the output memory limit", async () => {
    const s = setup();
    await s.start();
    s.send({ type: "limit" });
    expect(s.ended).toHaveBeenCalledOnce();
    expect(s.error).not.toHaveBeenCalled();
    await s.recorder.dispose();
  });
});
