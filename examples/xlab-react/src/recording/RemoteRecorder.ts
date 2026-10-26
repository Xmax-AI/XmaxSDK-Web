import type { RealtimeMediaFrame, XmaxRealtimeManaging } from "@xmaxai/web-sdk";
import type { RecordingRequest, RecordingResponse, RecordingResult } from "./recordingMessages";

/** XLab 自己的录制器；SDK 仅负责提供原始音视频帧。 */
export class RemoteRecorder {
  private worker?: Worker;
  private accepting = false;
  private disposed = false;
  private streamID?: string;
  private sequence = 0;
  private readonly pending = new Map<number, number>();
  private pendingBytes = 0;
  private ready?: () => void;
  private complete?: (result: RecordingResult) => void;
  private reject?: (error: Error) => void;
  private timer?: ReturnType<typeof setTimeout>;
  private stopping?: Promise<RecordingResult>;

  constructor(
    private readonly realtime: Pick<XmaxRealtimeManaging, "setRemoteMediaFrameListener">,
    private readonly onError: (error: Error) => void,
    private readonly onEnded: () => void,
    private readonly createWorker = () => new Worker(new URL("./recording.worker.ts", import.meta.url), { type: "module" }),
  ) {}

  async start(): Promise<void> {
    try {
      this.worker = this.createWorker();
      this.worker.onmessage = ({ data }: MessageEvent<RecordingResponse>) => this.receive(data);
      this.worker.onerror = event => this.fail(new Error(event.message || "录制编码线程出错"));
      const ready = new Promise<void>((resolve, reject) => {
        this.ready = resolve;
        this.reject = reject;
        this.timer = setTimeout(() => this.fail(new Error("录制初始化超时")), 10_000);
      });
      this.post({ type: "start" });
      // 在按钮的用户手势调用链里准备音频，不等 Worker 加载后才解锁 AudioContext。
      await Promise.all([ready, this.realtime.setRemoteMediaFrameListener(packet => this.add(packet))]);
      if (this.disposed) throw new Error("录制已取消");
      clearTimeout(this.timer);
      this.accepting = true;
    } catch (error) {
      await this.dispose();
      throw error;
    }
  }

  stop(): Promise<RecordingResult> {
    return this.stopping ??= this.finish();
  }

  private async finish(): Promise<RecordingResult> {
    this.accepting = false;
    try {
      // 会话同时关闭时，SDK 也可能取消监听；已接收的帧仍可完成封装。
      await this.realtime.setRemoteMediaFrameListener(undefined).catch(() => {});
      if (this.disposed) throw new Error("录制已取消");
      const result = new Promise<RecordingResult>((resolve, reject) => {
        this.complete = resolve;
        this.reject = reject;
        this.timer = setTimeout(() => this.fail(new Error("录制保存超时")), 15_000);
      });
      this.post({ type: "stop" });
      return await result;
    } finally {
      await this.dispose();
    }
  }

  /** 丢弃未保存的录制；不关闭会话或原始 RTC 轨道。 */
  async dispose(): Promise<void> {
    if (this.disposed) return;
    this.disposed = true;
    this.accepting = false;
    clearTimeout(this.timer);
    this.reject?.(new Error("录制已取消"));
    this.worker?.terminate();
    this.worker = undefined;
    this.pending.clear();
    this.pendingBytes = 0;
    await this.realtime.setRemoteMediaFrameListener(undefined).catch(() => {});
  }

  private add(packet: RealtimeMediaFrame): void {
    const video = packet.content.type === "video" ? packet.content.frame.frame : undefined;
    if (!this.accepting) {
      video?.close();
      return;
    }
    this.streamID ??= packet.streamID;
    if (this.streamID !== packet.streamID) {
      video?.close();
      this.accepting = false;
      this.onEnded();
      return;
    }
    const bytes = packet.content.type === "audio" ? packet.content.frame.data.byteLength
      : packet.content.frame.frame.displayWidth * packet.content.frame.frame.displayHeight * 4;
    if (this.pendingBytes + bytes > 32 * 1024 * 1024 || this.pending.size >= 256) {
      video?.close();
      this.fail(new Error("录制编码跟不上接收速度，已停止录制，请降低分辨率后重试"));
      return;
    }
    const id = ++this.sequence;
    this.pending.set(id, bytes);
    this.pendingBytes += bytes;
    try {
      const transfer: Transferable[] = packet.content.type === "video" ? [packet.content.frame.frame]
        : [packet.content.frame.data.buffer as ArrayBuffer];
      this.post({ type: "frame", id, packet }, transfer);
    } catch (error) {
      video?.close();
      this.fail(error instanceof Error ? error : new Error(String(error)));
    }
  }

  private post(message: RecordingRequest, transfer: Transferable[] = []): void {
    this.worker!.postMessage(message, transfer);
  }

  private receive(message: RecordingResponse): void {
    if (this.disposed) return;
    switch (message.type) {
      case "ready": this.ready?.(); break;
      case "accepted":
        this.pendingBytes -= this.pending.get(message.id) ?? 0;
        this.pending.delete(message.id);
        break;
      case "limit": this.accepting = false; this.onEnded(); break;
      case "complete":
        this.complete?.({ blob: message.blob,
          fileName: `xmax-recording-${new Date().toISOString().replace(/[:.]/g, "-")}.${message.extension}` });
        break;
      case "error": this.fail(new Error(message.message)); break;
    }
  }

  private fail(error: Error): void {
    if (this.disposed) return;
    const recording = this.accepting;
    this.reject?.(error);
    void this.dispose();
    if (recording) this.onError(error);
  }
}
