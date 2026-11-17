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
import { VideoRenderRegistry } from "../src/Render/Video/VideoRenderRegistry";
import type { XmaxRealtimeVideoView } from "../src/Render/Video/XmaxRealtimeVideoView";
import { RealtimeModel } from "../src/Service/Realtime/RealtimeModel";
import { MediaService } from "../src/Service/Media/MediaService";
import { RealtimeVideoFormat } from "../src/Service/Realtime/RealtimeVideoFormat";
import { cameraRotationEnvironment } from "./helpers/CameraRotationEnvironment";

vi.mock("../src/Foundation/Media/Camera/CameraFrameValidator", () => ({ waitForValidCameraFrame: vi.fn() }));
afterEach(() => { vi.resetAllMocks(); vi.unstubAllGlobals(); });
const operationSignal = new AbortController().signal;

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
  muted = true;
  readyState: "live" | "ended" = "live";
  private listeners = new Map<string, Array<() => void>>();

  constructor(readonly kind: "video" | "audio", private constraints: MediaTrackConstraints = {}) {}

  getSettings = (): MediaTrackSettings => ({
    width: (this.constraints.width as ConstrainULongRange | undefined)?.ideal,
    height: (this.constraints.height as ConstrainULongRange | undefined)?.ideal,
  });
  getConstraints = () => this.constraints;
  applyConstraints = vi.fn(async (constraints: MediaTrackConstraints) => { this.constraints = constraints; });
  stop = vi.fn(() => { this.readyState = "ended"; });

  addEventListener(type: string, listener: () => void): void {
    const list = this.listeners.get(type) ?? [];
    list.push(listener);
    this.listeners.set(type, list);
  }

  removeEventListener(): void {}

  emit(type: string): void {
    if (type === "unmute") this.muted = false;
    for (const listener of this.listeners.get(type) ?? []) listener();
  }
}

class RtcManagingStub implements RtcManaging {
  getRemoteAudioTrack(): MediaStreamTrack | undefined { return undefined; }
  async updateCredentials(): Promise<void> {}
  isInitialized = false;
  initializeCalls = 0;
  destroyCalls = 0;

  async initialize(): Promise<void> {
    this.initializeCalls += 1;
    this.isInitialized = true;
  }

  async destroy(): Promise<void> {
    this.destroyCalls += 1;
    this.isInitialized = false;
  }

  async startCameraCapture(_options: RtcCameraCaptureOptions): Promise<MediaStreamTrack> {
    throw new Error("RTC must not open the camera");
  }

  async switchCameraCapture(): Promise<MediaStreamTrack> {
    throw new Error("RTC must not switch the browser camera");
  }

  async stopCameraCapture(): Promise<void> { throw new Error("RTC does not own the camera"); }
  setExternalMediaTracks = vi.fn(async (_tracks: { videoTrack: MediaStreamTrack; audioTrack?: MediaStreamTrack; source?: "camera" }) => {});
  replaceCameraVideoTrack = vi.fn(async (_track: MediaStreamTrack) => {});
  async configureVideoEncoding(): Promise<void> {}
  async joinRoom(): Promise<void> {}
  async leaveRoom(): Promise<void> {}
  async publishLocalVideo(): Promise<void> {}
  async unpublishLocalVideo(): Promise<void> {}
  async publishLocalAudio(): Promise<void> {}
  async unpublishLocalAudio(): Promise<void> {}
  async subscribeRemoteVideo(): Promise<MediaStreamTrack | undefined> { return undefined; }
  async subscribeRemoteAudio(): Promise<void> {}
  readonly supportsRemoteAudioVolumeControl = true;
  setRemoteAudioVolume(): void {}
  async sendRoomMessage(): Promise<void> {}
  setEventListener(): void {}
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
  const tracks: FakeMediaStreamTrack[] = [];
  const getUserMedia = vi.fn(async (request: MediaStreamConstraints) => {
    const kind = request.video ? "video" : "audio";
    const track = new FakeMediaStreamTrack(kind, typeof request.video === "object" ? request.video : undefined);
    tracks.push(track);
    return { getTracks: () => [track as unknown as MediaStreamTrack] };
  });
  vi.stubGlobal("navigator", { mediaDevices: { getUserMedia } });
  return { controller, rtc, permission, tracks, getUserMedia };
}

function attachPreview(track: { mediaStreamTrack?: MediaStreamTrack } & object) {
  const binding = VideoRenderRegistry.binding(track as never);
  const view = {
    isMirrored: false,
    setMediaStream: () => {},
  } as unknown as XmaxRealtimeVideoView;
  binding?.attachHandler(view, "fill" as never);
  return view;
}

const defaultFormat = new RealtimeVideoFormat({
  width: 1080,
  height: 1920,
  fps: 30,
});

describe("CameraController", () => {
  it("crops a portrait capture to the requested landscape track used for preview and publication", async () => {
    const { controller, rtc, getUserMedia } = makeController();
    const env = cameraRotationEnvironment();
    env.video.videoWidth = 1080;
    env.video.videoHeight = 1920;
    const source = new FakeMediaStreamTrack("video", { width: { ideal: 1080 }, height: { ideal: 1920 } });
    getUserMedia.mockResolvedValueOnce({ getTracks: () => [source as unknown as MediaStreamTrack] });
    const pending = controller.createLocalCameraStream({
      videoFormat: defaultFormat.resized(1920, 1080), position: CameraPosition.front, useMicrophone: false,
    }, operationSignal);
    await vi.waitFor(() => expect(env.callbacks.size).toBe(1));
    env.frame();
    const stream = await pending;
    expect(env.canvas).toMatchObject({ width: 1920, height: 1080 });
    const [, x, y, width, height] = env.context.drawImage.mock.calls[0]!;
    expect(x).toBe(0);
    expect(width).toBe(1080);
    expect(height).toBeCloseTo(607.5);
    expect(y).toBeCloseTo((1920 - 607.5) / 2);
    expect(stream.videoTrack?.mediaStreamTrack).toBe(env.output);
    await controller.prepareForConnection(operationSignal);
    expect(rtc.setExternalMediaTracks).toHaveBeenCalledWith({ videoTrack: env.output, audioTrack: undefined, source: "camera" });
    await controller.stopLocalCameraStream();
    expect(source.stop).toHaveBeenCalledOnce();
    expect(env.output.stop).toHaveBeenCalledOnce();
  });

  it.each([undefined, "usb-microphone"])("reacquires microphone input %s on reconnect while keeping the selected camera", async microphoneDeviceId => {
    const { controller, rtc, getUserMedia, tracks } = makeController();
    const stream = await controller.createLocalCameraStream({
      videoFormat: defaultFormat, position: CameraPosition.front, useMicrophone: true,
      cameraDeviceId: "usb-camera", microphoneDeviceId,
    }, operationSignal);
    expect(getUserMedia.mock.calls).toEqual([[{ video: {
      width: { ideal: 1080 }, height: { ideal: 1920 }, frameRate: { ideal: 30 }, deviceId: { exact: "usb-camera" },
    } }]]);
    const microphoneRequest = { audio: { echoCancellation: true, autoGainControl: true, noiseSuppression: true,
      ...(microphoneDeviceId && { deviceId: { exact: microphoneDeviceId } }),
    } };
    await controller.prepareForConnection(operationSignal);
    expect(getUserMedia).toHaveBeenLastCalledWith(microphoneRequest);
    expect(rtc.setExternalMediaTracks).toHaveBeenCalledWith({ videoTrack: stream.videoTrack?.mediaStreamTrack, audioTrack: tracks[1], source: "camera" });
    await controller.releaseConnectionMedia();
    expect(tracks[1]!.stop).toHaveBeenCalledOnce();
    expect(tracks[0]!.stop).not.toHaveBeenCalled();
    await controller.prepareForConnection(operationSignal);
    expect(getUserMedia).toHaveBeenLastCalledWith(microphoneRequest);
    expect(rtc.setExternalMediaTracks).toHaveBeenLastCalledWith({ videoTrack: stream.videoTrack?.mediaStreamTrack, audioTrack: tracks[2], source: "camera" });
    await controller.stopLocalCameraStream();
    expect(tracks[2]!.stop).toHaveBeenCalledOnce();
  });

  it("cancels a pending permission prompt and stops tracks returned afterward", async () => {
    const { controller, getUserMedia } = makeController();
    const abort = new AbortController();
    let finish!: (stream: { getTracks(): MediaStreamTrack[] }) => void;
    getUserMedia.mockReturnValueOnce(new Promise(resolve => { finish = resolve; }));
    const pending = controller.createLocalCameraStream({
      videoFormat: defaultFormat, position: CameraPosition.front, useMicrophone: false,
    }, abort.signal);
    const rejected = expect(pending).rejects.toMatchObject({ code: XmaxErrorCode.cancelled });
    await vi.waitFor(() => expect(getUserMedia).toHaveBeenCalledOnce());
    abort.abort();
    await rejected;
    const lateTrack = new FakeMediaStreamTrack("video");
    finish({ getTracks: () => [lateTrack as unknown as MediaStreamTrack] });
    await vi.waitFor(() => expect(lateTrack.stop).toHaveBeenCalledOnce());
    expect(controller.currentTrack).toBeUndefined();
  });

  it("updates capture in place while retaining the SDK track and mounted preview", async () => {
    const { controller, tracks, getUserMedia } = makeController();
    const local = await controller.createLocalCameraStream({
      videoFormat: defaultFormat, position: CameraPosition.back, useMicrophone: true,
    }, operationSignal);
    const track = local.videoTrack!;
    const original = track.mediaStreamTrack;
    const setMediaStream = vi.fn();
    const view = { isMirrored: false, setMediaStream };
    const binding = VideoRenderRegistry.binding(track)!;
    binding.attachHandler(view, "fill" as never);
    const preview = setMediaStream.mock.calls[0]![0] as MediaStream;
    const target = new RealtimeVideoFormat({ width: 1408, height: 1408, fps: 24, minimumBitrate: 1200, maximumBitrate: 4000 });
    await controller.updateVideoFormat(target, operationSignal);
    expect(controller.currentTrack).toBe(track);
    expect(track.videoFormat).toEqual(target);
    expect(track.mediaStreamTrack).toBe(original);
    expect(preview.getTracks()).toEqual([track.mediaStreamTrack]);
    expect(VideoRenderRegistry.binding(track)).toBe(binding);
    expect(setMediaStream).toHaveBeenCalledOnce();
    expect(tracks[0]!.applyConstraints).toHaveBeenCalledWith({
      width: { ideal: 1408 }, height: { ideal: 1408 }, frameRate: { ideal: 24 }, facingMode: { ideal: "environment" },
    });
    expect(controller.useMicrophone).toBe(true);
    expect(getUserMedia).toHaveBeenCalledOnce();
    await controller.stopLocalCameraStream();
  });

  it("keeps track metadata and preview when a capture format update fails", async () => {
    const { controller, tracks } = makeController();
    const local = await controller.createLocalCameraStream({ videoFormat: defaultFormat, position: CameraPosition.front, useMicrophone: false }, operationSignal);
    const track = local.videoTrack!, format = track.videoFormat, native = track.mediaStreamTrack;
    tracks[0]!.applyConstraints.mockRejectedValueOnce(new Error("capture failed"));
    await expect(controller.updateVideoFormat(defaultFormat.resized(1408, 1408), operationSignal)).rejects.toThrow("capture failed");
    expect(track.videoFormat).toBe(format);
    expect(track.mediaStreamTrack).toBe(native);
    await expect(controller.updateVideoFormat(defaultFormat.resized(1280, 720), operationSignal)).rejects.toThrow("does not support input resolution");
    expect(tracks[0]!.applyConstraints).toHaveBeenCalledOnce();
    await controller.stopLocalCameraStream();
  });

  it("does not restore metadata after close during a capture format update", async () => {
    const { controller, tracks } = makeController();
    const local = await controller.createLocalCameraStream({ videoFormat: defaultFormat, position: CameraPosition.front, useMicrophone: false }, operationSignal);
    let finish!: () => void;
    tracks[0]!.applyConstraints.mockReturnValueOnce(new Promise(resolve => { finish = resolve; }));
    const pending = controller.updateVideoFormat(defaultFormat.resized(1408, 1408), operationSignal);
    const rejected = expect(pending).rejects.toMatchObject({ code: XmaxErrorCode.cancelled });
    await controller.stopLocalCameraStream();
    finish();
    await rejected;
    expect(controller.currentTrack).toBeUndefined();
    expect(local.videoTrack!.mediaStreamTrack).toBeUndefined();
  });

  it("forwards rotation without swapping the public format or changing preview mirroring", async () => {
    const { controller, getUserMedia } = makeController();
    const env = cameraRotationEnvironment();
    const pending = controller.createLocalCameraStream({
      videoFormat: defaultFormat, position: CameraPosition.front, useMicrophone: false, rotation: 90,
    }, operationSignal);
    await vi.waitFor(() => expect(env.callbacks.size).toBe(1));
    env.frame();
    const stream = await pending;
    expect(getUserMedia).toHaveBeenCalledWith({ video: {
      width: { ideal: 1920 }, height: { ideal: 1080 }, frameRate: { ideal: 30 }, facingMode: { ideal: "user" },
    } });
    expect(stream.videoTrack?.mediaStreamTrack).toBe(env.output);
    expect(stream.videoTrack?.videoFormat).toMatchObject({ width: 1080, height: 1920 });
    expect(attachPreview(stream.videoTrack!).isMirrored).toBe(true);
    await controller.stopLocalCameraStream();
  });

  it("rejects invalid rotation before capture starts", async () => {
    const { controller, rtc, getUserMedia } = makeController();
    await expect(controller.createLocalCameraStream({
      videoFormat: defaultFormat, position: CameraPosition.front, useMicrophone: false, rotation: 45 as any,
    }, operationSignal)).rejects.toMatchObject({ code: XmaxErrorCode.invalidConfiguration });
    expect(rtc.initializeCalls).toBe(0);
    expect(getUserMedia).not.toHaveBeenCalled();
  });
  it.each([undefined, true, false])("uses per-stream frame validation option %s", async (enableFrameValidation) => {
    const { controller } = makeController();
    await controller.createLocalCameraStream({
      videoFormat: defaultFormat, position: CameraPosition.front, useMicrophone: false, enableFrameValidation,
    }, operationSignal);
    expect(controller.isFrameValidationEnabled).toBe(enableFrameValidation ?? true);
    await controller.waitForValidCameraFrame(new AbortController().signal);
    expect(waitForValidCameraFrame).toHaveBeenCalledTimes(enableFrameValidation === false ? 0 : 1);
    await controller.stopLocalCameraStream();
    expect(controller.isFrameValidationEnabled).toBe(false);
  });

  it("retains disabled validation across camera switches and restores the default for a new stream", async () => {
    const { controller } = makeController();
    const options = { videoFormat: defaultFormat, position: CameraPosition.front, useMicrophone: false };
    await controller.createLocalCameraStream({ ...options, enableFrameValidation: false }, operationSignal);
    await controller.switchCamera(operationSignal);
    expect(controller.isFrameValidationEnabled).toBe(false);
    await controller.waitForValidCameraFrame(new AbortController().signal);
    expect(waitForValidCameraFrame).not.toHaveBeenCalled();
    await controller.stopLocalCameraStream();
    await controller.createLocalCameraStream(options, operationSignal);
    expect(controller.isFrameValidationEnabled).toBe(true);
    await controller.waitForValidCameraFrame(new AbortController().signal);
    expect(waitForValidCameraFrame).toHaveBeenCalledOnce();
    await controller.stopLocalCameraStream();
  });

  it("keeps cancellation effective even when frame validation is disabled", async () => {
    const { controller } = makeController();
    await controller.createLocalCameraStream({
      videoFormat: defaultFormat, position: CameraPosition.front, useMicrophone: false, enableFrameValidation: false,
    }, operationSignal);
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
    }, operationSignal);
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
    }, operationSignal);
    let ready!: () => void;
    vi.mocked(waitForValidCameraFrame).mockReturnValueOnce(new Promise<void>((resolve) => { ready = resolve; }));
    const pending = controller.waitForValidCameraFrame(new AbortController().signal);
    await controller.switchCamera(operationSignal);
    ready();
    await expect(pending).rejects.toMatchObject({ code: XmaxErrorCode.cancelled });
    await controller.stopLocalCameraStream();
  });

  it("creates a local camera stream with the resolved format", async () => {
    const { controller, rtc, getUserMedia } = makeController();
    const stream = await controller.createLocalCameraStream({
      videoFormat: defaultFormat,
      position: CameraPosition.front,
      useMicrophone: false,
    }, operationSignal);

    expect(stream.videoTrack?.id).toBe("video0");
    expect(stream.videoTrack?.videoFormat?.width).toBe(1080);
    expect(stream.videoTrack?.videoFormat?.height).toBe(1920);
    expect(rtc.initializeCalls).toBe(0);
    expect(getUserMedia).toHaveBeenCalledOnce();
    expect(controller.currentTrack).toBe(stream.videoTrack);
  });

  it("rejects creating a second camera stream while one is active", async () => {
    const { controller } = makeController();
    await controller.createLocalCameraStream({
      videoFormat: defaultFormat,
      position: CameraPosition.front,
      useMicrophone: false,
    }, operationSignal);
    await expect(
      controller.createLocalCameraStream({
        videoFormat: defaultFormat,
        position: CameraPosition.front,
        useMicrophone: false,
      }, operationSignal),
    ).rejects.toMatchObject({ code: XmaxErrorCode.invalidConfiguration });
  });

  it("cleans up when capture start fails", async () => {
    const { controller, rtc, getUserMedia } = makeController();
    getUserMedia.mockRejectedValueOnce(new Error("no camera"));
    await expect(
      controller.createLocalCameraStream({
        videoFormat: defaultFormat,
        position: CameraPosition.front,
        useMicrophone: false,
      }, operationSignal),
    ).rejects.toMatchObject({ code: XmaxErrorCode.mediaError });
    expect(controller.currentTrack).toBeUndefined();
    expect(rtc.initializeCalls).toBe(0);
  });

  it("stops the camera stream, destroys the engine and unregisters the preview binding", async () => {
    const { controller, rtc, tracks } = makeController();
    const stream = await controller.createLocalCameraStream({
      videoFormat: defaultFormat,
      position: CameraPosition.front,
      useMicrophone: false,
    }, operationSignal);
    await controller.prepareForConnection(operationSignal);
    await controller.stopLocalCameraStream();
    expect(controller.currentTrack).toBeUndefined();
    expect(tracks[0]!.stop).toHaveBeenCalledOnce();
    expect(rtc.destroyCalls).toBe(1);
    expect(VideoRenderRegistry.binding(stream.videoTrack as never)).toBeUndefined();
  });

  it("switches between front and back cameras on the same track", async () => {
    const { controller, rtc, getUserMedia, tracks } = makeController();
    const stream = await controller.createLocalCameraStream({
      videoFormat: defaultFormat,
      position: CameraPosition.front,
      useMicrophone: false,
    }, operationSignal);
    const previousMediaTrack = stream.videoTrack?.mediaStreamTrack;
    await controller.prepareForConnection(operationSignal);
    const switched = await controller.switchCamera(operationSignal);
    expect(getUserMedia).toHaveBeenLastCalledWith({ video: expect.objectContaining({ facingMode: { ideal: "environment" } }) });
    expect(rtc.replaceCameraVideoTrack).toHaveBeenCalledWith(switched.videoTrack?.mediaStreamTrack);
    expect(tracks[0]!.stop).toHaveBeenCalledOnce();
    expect(switched.videoTrack).toBe(stream.videoTrack);
    expect(switched.videoTrack?.position).toBe(CameraPosition.back);
    expect(switched.videoTrack?.mediaStreamTrack).toBeDefined();
    expect(switched.videoTrack?.mediaStreamTrack).not.toBe(previousMediaTrack);
  });

  it("throws when switching without an active stream", async () => {
    const { controller } = makeController();
    await expect(controller.switchCamera(operationSignal)).rejects.toMatchObject({
      code: XmaxErrorCode.rtcError,
    });
  });

  it("fires the preview-ready handler only after the first frame and view attach", async () => {
    const { controller, tracks } = makeController();
    const stream = await controller.createLocalCameraStream({
      videoFormat: defaultFormat,
      position: CameraPosition.front,
      useMicrophone: false,
    }, operationSignal);

    let readyCount = 0;
    controller.setPreviewReadyHandler(() => {
      readyCount += 1;
    });

    // 仅收到首帧：不就绪。
    tracks[0]!.emit("unmute");
    expect(readyCount).toBe(0);

    // 绑定预览视图后就绪，且只通知一次。
    attachPreview(stream.videoTrack as never);
    expect(readyCount).toBe(1);

    tracks[0]!.emit("unmute");
    expect(readyCount).toBe(1);
  });

  it("mirrors only the front-camera preview and updates it when switching", async () => {
    const { controller } = makeController();
    const stream = await controller.createLocalCameraStream({
      videoFormat: defaultFormat,
      position: CameraPosition.front,
      useMicrophone: false,
    }, operationSignal);
    const view = attachPreview(stream.videoTrack as never);
    expect(view.isMirrored).toBe(true);
    await controller.switchCamera(operationSignal);
    expect(view.isMirrored).toBe(false);
    await controller.switchCamera(operationSignal);
    expect(view.isMirrored).toBe(true);
  });
});
