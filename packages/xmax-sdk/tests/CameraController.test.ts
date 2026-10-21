import { afterEach, describe, expect, it, vi } from "vitest";
import { waitForValidCameraFrame } from "../src/Foundation/Media/Camera/CameraFrameValidator";
import { CameraPosition } from "../src/Foundation/Media/Camera/CameraPosition";
import { XmaxError, XmaxErrorCode } from "../src/Foundation/Errors/XmaxError";
import type { PermissionManaging } from "../src/Foundation/Permissions/PermissionManaging";
import type {
  RtcCameraCaptureOptions,
  RtcManaging,
} from "../src/Foundation/RTC/RtcManaging";
import { CameraController } from "../src/Media/Camera/CameraController";
import { VideoRenderRegistry } from "../src/Service/Realtime/VideoRenderBinding";
import type { XmaxVideoView } from "../src/Render/Video/XmaxVideoView";
import { RealtimeModel } from "../src/Service/Realtime/RealtimeModel";
import { MediaService } from "../src/Service/Media/MediaService";
import { RealtimeVideoFormat } from "../src/Service/Realtime/RealtimeVideoFormat";
import type { VideoEncodingConfiguration } from "../src/Foundation/RTC/VideoEncodingConfiguration";

vi.mock("../src/Foundation/Media/Camera/CameraFrameValidator", () => ({ waitForValidCameraFrame: vi.fn() }));
afterEach(() => vi.resetAllMocks());

/** Node 环境没有 MediaStream，提供最小实现供预览流逻辑使用。 */
class MediaStreamStub {
  private tracks: MediaStreamTrack[];

  constructor(tracks: MediaStreamTrack[] = []) {
    this.tracks = [...tracks];
  }

  addTrack(track: MediaStreamTrack): void {
    this.tracks.push(track);
  }

  removeTrack(track: MediaStreamTrack): void {
    this.tracks = this.tracks.filter((item) => item !== track);
  }

  getTracks(): MediaStreamTrack[] {
    return [...this.tracks];
  }
}

(globalThis as Record<string, unknown>).MediaStream ??= MediaStreamStub;

/** 支持 unmute 事件模拟的假视频轨。 */
class FakeMediaStreamTrack {
  readonly id: string;
  muted = true;
  readyState: "live" | "ended" = "live";

  private listeners = new Map<string, Array<() => void>>();

  constructor(id: string) {
    this.id = id;
  }

  addEventListener(type: string, listener: () => void): void {
    const list = this.listeners.get(type) ?? [];
    list.push(listener);
    this.listeners.set(type, list);
  }

  removeEventListener(): void {}

  emit(type: string): void {
    if (type === "unmute") {
      this.muted = false;
    }
    for (const listener of this.listeners.get(type) ?? []) {
      listener();
    }
  }
}

class RtcManagingStub implements RtcManaging {
  getRemoteAudioTrack(): MediaStreamTrack | undefined { return undefined; }
  async updateCredentials(): Promise<void> {}
  isInitialized = false;
  initializeCalls = 0;
  destroyCalls = 0;
  stopCaptureCalls = 0;
  startCalls: RtcCameraCaptureOptions[] = [];
  switchCalls: CameraPosition[] = [];
  failNextStart?: XmaxError;

  private tracks: FakeMediaStreamTrack[] = [];

  async initialize(): Promise<void> {
    this.initializeCalls += 1;
    this.isInitialized = true;
  }

  async destroy(): Promise<void> {
    this.destroyCalls += 1;
    this.isInitialized = false;
  }

  async startCameraCapture(
    options: RtcCameraCaptureOptions,
  ): Promise<MediaStreamTrack> {
    if (this.failNextStart) {
      const error = this.failNextStart;
      this.failNextStart = undefined;
      throw error;
    }
    this.startCalls.push(options);
    return this.makeTrack();
  }

  async switchCameraCapture(to: CameraPosition): Promise<MediaStreamTrack> {
    this.switchCalls.push(to);
    return this.makeTrack();
  }

  async stopCameraCapture(): Promise<void> {
    this.stopCaptureCalls += 1;
  }

  async configureVideoEncoding(): Promise<void> {}

  updateCameraCapture = vi.fn(async (_options: RtcCameraCaptureOptions): Promise<MediaStreamTrack> => this.makeTrack());

  encodingConfigurations: VideoEncodingConfiguration[] = [];

  // 房间与发布能力：相机管线测试不涉及，空实现满足接口。
  async joinRoom(): Promise<void> {}
  async leaveRoom(): Promise<void> {}
  async publishLocalVideo(): Promise<void> {}
  async unpublishLocalVideo(): Promise<void> {}
  async publishLocalAudio(): Promise<void> {}
  async unpublishLocalAudio(): Promise<void> {}
  async subscribeRemoteVideo(): Promise<MediaStreamTrack | undefined> {
    return undefined;
  }
  async subscribeRemoteAudio(): Promise<void> {}
  readonly supportsRemoteAudioVolumeControl = true;
  setRemoteAudioVolume(): void {}
  async sendRoomMessage(): Promise<void> {}
  setEventListener(): void {}

  /** 让最近一次采集产出的视频轨收到首帧。 */
  emitFirstFrame(): void {
    this.tracks[this.tracks.length - 1]?.emit("unmute");
  }

  private makeTrack(): MediaStreamTrack {
    const track = new FakeMediaStreamTrack(`track-${this.tracks.length}`);
    this.tracks.push(track);
    return track as unknown as MediaStreamTrack;
  }
}

class PermissionManagingStub implements PermissionManaging {
  cameraGranted = true;
  microphoneGranted = true;

  async ensureCameraPermission(): Promise<void> {
    if (!this.cameraGranted) {
      throw new XmaxError(
        XmaxErrorCode.cameraPermissionDenied,
        "Camera permission was denied",
      );
    }
  }

  async ensureMicrophonePermission(): Promise<void> {
    if (!this.microphoneGranted) {
      throw new XmaxError(
        XmaxErrorCode.microphonePermissionDenied,
        "Microphone permission was denied",
      );
    }
  }
}

function makeController() {
  const rtc = new RtcManagingStub();
  const permission = new PermissionManagingStub();
  const controller = new CameraController({
    permissionManager: permission,
    rtcManager: rtc,
    mediaService: new MediaService(RealtimeModel.x2_1),
  });
  return { controller, rtc, permission };
}

function attachPreview(track: { mediaStreamTrack?: MediaStreamTrack } & object) {
  const binding = VideoRenderRegistry.binding(track as never);
  const view = {
    isMirrored: false,
    setMediaStream: () => {},
  } as unknown as XmaxVideoView;
  binding?.attachHandler(view, "fill" as never);
  return view;
}

const defaultFormat = new RealtimeVideoFormat({
  width: 1080,
  height: 1920,
  fps: 30,
});

describe("CameraController", () => {
  it("updates capture in place while retaining the SDK track and mounted preview", async () => {
    const { controller, rtc } = makeController();
    const local = await controller.createLocalCameraStream({
      videoFormat: defaultFormat, position: CameraPosition.back, useMicrophone: true, rotation: 90,
    });
    const track = local.videoTrack!;
    const original = track.mediaStreamTrack;
    const setMediaStream = vi.fn();
    const view = { isMirrored: false, setMediaStream };
    const binding = VideoRenderRegistry.binding(track)!;
    binding.attachHandler(view, "fill" as never);
    const preview = setMediaStream.mock.calls[0]![0] as MediaStream;
    const target = new RealtimeVideoFormat({ width: 1408, height: 1408, fps: 24, minimumBitrate: 1200, maximumBitrate: 4000 });
    await controller.updateVideoFormat(target);
    expect(controller.currentTrack).toBe(track);
    expect(track.videoFormat).toEqual(target);
    expect(track.mediaStreamTrack).not.toBe(original);
    expect(preview.getTracks()).toEqual([track.mediaStreamTrack]);
    expect(VideoRenderRegistry.binding(track)).toBe(binding);
    expect(setMediaStream).toHaveBeenCalledOnce();
    expect(rtc.updateCameraCapture).toHaveBeenCalledWith({ width: 1408, height: 1408, frameRate: 24, position: CameraPosition.back, rotation: 90 });
    expect(controller.useMicrophone).toBe(true);
    expect(rtc.startCalls).toHaveLength(1);
    await controller.stopLocalCameraStream();
  });

  it("keeps track metadata and preview when a capture format update fails", async () => {
    const { controller, rtc } = makeController();
    const local = await controller.createLocalCameraStream({ videoFormat: defaultFormat, position: CameraPosition.front, useMicrophone: false });
    const track = local.videoTrack!, format = track.videoFormat, native = track.mediaStreamTrack;
    rtc.updateCameraCapture.mockRejectedValueOnce(new Error("capture failed"));
    await expect(controller.updateVideoFormat(defaultFormat.resized(1408, 1408))).rejects.toThrow("capture failed");
    expect(track.videoFormat).toBe(format);
    expect(track.mediaStreamTrack).toBe(native);
    await expect(controller.updateVideoFormat(defaultFormat.resized(1280, 720))).rejects.toThrow("does not support input resolution");
    expect(rtc.updateCameraCapture).toHaveBeenCalledOnce();
    await controller.stopLocalCameraStream();
  });

  it("does not restore metadata after close during a capture format update", async () => {
    const { controller, rtc } = makeController();
    const local = await controller.createLocalCameraStream({ videoFormat: defaultFormat, position: CameraPosition.front, useMicrophone: false });
    let finish!: (track: MediaStreamTrack) => void;
    rtc.updateCameraCapture.mockReturnValueOnce(new Promise(resolve => { finish = resolve; }));
    const pending = controller.updateVideoFormat(defaultFormat.resized(1408, 1408));
    const rejected = expect(pending).rejects.toMatchObject({ code: XmaxErrorCode.cancelled });
    await controller.stopLocalCameraStream();
    finish({} as MediaStreamTrack);
    await rejected;
    expect(controller.currentTrack).toBeUndefined();
    expect(local.videoTrack!.mediaStreamTrack).toBeUndefined();
  });

  it("forwards rotation without swapping the public format or changing preview mirroring", async () => {
    const { controller, rtc } = makeController();
    const stream = await controller.createLocalCameraStream({
      videoFormat: defaultFormat, position: CameraPosition.front, useMicrophone: false, rotation: 90,
    });
    expect(rtc.startCalls[0]).toMatchObject({ width: 1080, height: 1920, rotation: 90 });
    expect(stream.videoTrack?.videoFormat).toMatchObject({ width: 1080, height: 1920 });
    expect(attachPreview(stream.videoTrack!).isMirrored).toBe(true);
    await controller.stopLocalCameraStream();
  });

  it("rejects invalid rotation before capture starts", async () => {
    const { controller, rtc } = makeController();
    await expect(controller.createLocalCameraStream({
      videoFormat: defaultFormat, position: CameraPosition.front, useMicrophone: false, rotation: 45 as any,
    })).rejects.toMatchObject({ code: XmaxErrorCode.invalidConfiguration });
    expect(rtc.initializeCalls).toBe(0);
    expect(rtc.startCalls).toHaveLength(0);
  });
  it.each([undefined, true, false])("uses per-stream frame validation option %s", async (enableFrameValidation) => {
    const { controller } = makeController();
    await controller.createLocalCameraStream({
      videoFormat: defaultFormat, position: CameraPosition.front, useMicrophone: false, enableFrameValidation,
    });
    expect(controller.isFrameValidationEnabled).toBe(enableFrameValidation ?? true);
    await controller.waitForValidCameraFrame(new AbortController().signal);
    expect(waitForValidCameraFrame).toHaveBeenCalledTimes(enableFrameValidation === false ? 0 : 1);
    await controller.stopLocalCameraStream();
    expect(controller.isFrameValidationEnabled).toBe(false);
  });

  it("retains disabled validation across camera switches and restores the default for a new stream", async () => {
    const { controller } = makeController();
    const options = { videoFormat: defaultFormat, position: CameraPosition.front, useMicrophone: false };
    await controller.createLocalCameraStream({ ...options, enableFrameValidation: false });
    await controller.switchCamera();
    expect(controller.isFrameValidationEnabled).toBe(false);
    await controller.waitForValidCameraFrame(new AbortController().signal);
    expect(waitForValidCameraFrame).not.toHaveBeenCalled();
    await controller.stopLocalCameraStream();
    await controller.createLocalCameraStream(options);
    expect(controller.isFrameValidationEnabled).toBe(true);
    await controller.waitForValidCameraFrame(new AbortController().signal);
    expect(waitForValidCameraFrame).toHaveBeenCalledOnce();
    await controller.stopLocalCameraStream();
  });

  it("keeps cancellation effective even when frame validation is disabled", async () => {
    const { controller } = makeController();
    await controller.createLocalCameraStream({
      videoFormat: defaultFormat, position: CameraPosition.front, useMicrophone: false, enableFrameValidation: false,
    });
    const abort = new AbortController();
    abort.abort();
    await expect(controller.waitForValidCameraFrame(abort.signal))
      .rejects.toMatchObject({ code: XmaxErrorCode.cancelled });
    expect(waitForValidCameraFrame).not.toHaveBeenCalled();
    await controller.stopLocalCameraStream();
  });

  it("checks exposure on the active captured track using the operation signal", async () => {
    const { controller } = makeController();
    const stream = await controller.createLocalCameraStream({
      videoFormat: defaultFormat, position: CameraPosition.front, useMicrophone: false,
    });
    const signal = new AbortController().signal;
    await controller.waitForValidCameraFrame(signal);
    expect(waitForValidCameraFrame).toHaveBeenCalledWith(stream.videoTrack?.mediaStreamTrack, signal);
    await controller.stopLocalCameraStream();
  });

  it("rejects exposure checks without active capture", async () => {
    const { controller } = makeController();
    await expect(controller.waitForValidCameraFrame(new AbortController().signal))
      .rejects.toMatchObject({ code: XmaxErrorCode.mediaError });
    expect(waitForValidCameraFrame).not.toHaveBeenCalled();
  });

  it("rejects a stale exposure result after the camera track changes", async () => {
    const { controller } = makeController();
    await controller.createLocalCameraStream({
      videoFormat: defaultFormat, position: CameraPosition.front, useMicrophone: false,
    });
    let ready!: () => void;
    vi.mocked(waitForValidCameraFrame).mockReturnValueOnce(new Promise<void>((resolve) => { ready = resolve; }));
    const pending = controller.waitForValidCameraFrame(new AbortController().signal);
    await controller.switchCamera();
    ready();
    await expect(pending).rejects.toMatchObject({ code: XmaxErrorCode.cancelled });
    await controller.stopLocalCameraStream();
  });

  it("creates a local camera stream with the resolved format", async () => {
    const { controller, rtc } = makeController();
    const stream = await controller.createLocalCameraStream({
      videoFormat: defaultFormat,
      position: CameraPosition.front,
      useMicrophone: false,
    });

    expect(stream.videoTrack?.id).toBe("video0");
    expect(stream.videoTrack?.videoFormat?.width).toBe(1080);
    expect(stream.videoTrack?.videoFormat?.height).toBe(1920);
    expect(rtc.initializeCalls).toBe(1);
    expect(rtc.startCalls).toHaveLength(1);
    expect(controller.currentTrack).toBe(stream.videoTrack);
  });

  it("rejects creating a second camera stream while one is active", async () => {
    const { controller } = makeController();
    await controller.createLocalCameraStream({
      videoFormat: defaultFormat,
      position: CameraPosition.front,
      useMicrophone: false,
    });
    await expect(
      controller.createLocalCameraStream({
        videoFormat: defaultFormat,
        position: CameraPosition.front,
        useMicrophone: false,
      }),
    ).rejects.toMatchObject({ code: XmaxErrorCode.invalidConfiguration });
  });

  it("cleans up when capture start fails", async () => {
    const { controller, rtc } = makeController();
    rtc.failNextStart = new XmaxError(XmaxErrorCode.mediaError, "no camera");
    await expect(
      controller.createLocalCameraStream({
        videoFormat: defaultFormat,
        position: CameraPosition.front,
        useMicrophone: false,
      }),
    ).rejects.toMatchObject({ code: XmaxErrorCode.mediaError });
    expect(controller.currentTrack).toBeUndefined();
    expect(rtc.stopCaptureCalls).toBe(1);
    expect(rtc.destroyCalls).toBe(1);
  });

  it("stops the camera stream, destroys the engine and unregisters the preview binding", async () => {
    const { controller, rtc } = makeController();
    const stream = await controller.createLocalCameraStream({
      videoFormat: defaultFormat,
      position: CameraPosition.front,
      useMicrophone: false,
    });
    await controller.stopLocalCameraStream();
    expect(controller.currentTrack).toBeUndefined();
    expect(rtc.stopCaptureCalls).toBe(1);
    expect(rtc.destroyCalls).toBe(1);
    expect(VideoRenderRegistry.binding(stream.videoTrack as never)).toBeUndefined();
  });

  it("switches between front and back cameras on the same track", async () => {
    const { controller, rtc } = makeController();
    const stream = await controller.createLocalCameraStream({
      videoFormat: defaultFormat,
      position: CameraPosition.front,
      useMicrophone: false,
    });
    const previousMediaTrack = stream.videoTrack?.mediaStreamTrack;
    const switched = await controller.switchCamera();
    expect(rtc.switchCalls).toEqual([CameraPosition.back]);
    expect(switched.videoTrack).toBe(stream.videoTrack);
    expect(switched.videoTrack?.position).toBe(CameraPosition.back);
    // 切换后轨道指向 RTC 层产出的新视频轨。
    expect(switched.videoTrack?.mediaStreamTrack).toBeDefined();
    expect(switched.videoTrack?.mediaStreamTrack).not.toBe(previousMediaTrack);
  });

  it("throws when switching without an active stream", async () => {
    const { controller } = makeController();
    await expect(controller.switchCamera()).rejects.toMatchObject({
      code: XmaxErrorCode.rtcError,
    });
  });

  it("fires the preview-ready handler only after the first frame and view attach", async () => {
    const { controller, rtc } = makeController();
    const stream = await controller.createLocalCameraStream({
      videoFormat: defaultFormat,
      position: CameraPosition.front,
      useMicrophone: false,
    });

    let readyCount = 0;
    controller.setPreviewReadyHandler(() => {
      readyCount += 1;
    });

    // 仅收到首帧：不就绪。
    rtc.emitFirstFrame();
    expect(readyCount).toBe(0);

    // 绑定预览视图后就绪，且只通知一次。
    attachPreview(stream.videoTrack as never);
    expect(readyCount).toBe(1);

    rtc.emitFirstFrame();
    expect(readyCount).toBe(1);
  });

  it("mirrors only the front-camera preview and updates it when switching", async () => {
    const { controller } = makeController();
    const stream = await controller.createLocalCameraStream({
      videoFormat: defaultFormat,
      position: CameraPosition.front,
      useMicrophone: false,
    });
    const view = attachPreview(stream.videoTrack as never);
    expect(view.isMirrored).toBe(true);
    await controller.switchCamera();
    expect(view.isMirrored).toBe(false);
    await controller.switchCamera();
    expect(view.isMirrored).toBe(true);
  });
});
