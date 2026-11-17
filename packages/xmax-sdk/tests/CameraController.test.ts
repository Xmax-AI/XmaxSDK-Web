import { RealtimeCamera } from "../src/Service/Realtime/RealtimeCamera";
import { RealtimeMicrophone } from "../src/Service/Realtime/RealtimeMicrophone";
import { afterEach, describe, expect, it, vi } from "vitest";
import { waitForCameraWarmup } from "../src/Foundation/Media/Camera/CameraWarmup";
import { CameraPosition } from "../src/Foundation/Media/Camera/CameraPosition";
import { AudioTrackFrameSource } from "../src/Foundation/Media/Audio/AudioTrackFrameSource";
import { VideoTrackFrameSource } from "../src/Foundation/Media/Video/VideoTrackFrameSource";
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
import type { RealtimeMediaFrame } from "../src/Service/Realtime/RealtimeMediaFrame";
import { cameraRotationEnvironment } from "./helpers/CameraRotationEnvironment";

vi.mock("../src/Foundation/Media/Camera/CameraWarmup", () => ({ waitForCameraWarmup: vi.fn() }));
afterEach(() => { vi.useRealTimers(); vi.restoreAllMocks(); vi.resetAllMocks(); vi.unstubAllGlobals(); });
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
  const enumerateDevices = vi.fn(async (): Promise<MediaDeviceInfo[]> => []);
  vi.stubGlobal("navigator", { mediaDevices: { getUserMedia, enumerateDevices } });
  const env = cameraRotationEnvironment({ automaticFirstFrame: true });
  env.video.videoWidth = 1080;
  env.video.videoHeight = 1920;
  return { controller, rtc, permission, tracks, getUserMedia, enumerateDevices, env };
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
  it("observes the preview track before RTC, follows camera replacement, and needs no audio for video-only capture", async () => {
    const { controller, rtc, tracks, getUserMedia } = makeController();
    vi.useFakeTimers();
    vi.stubGlobal("VideoFrame", class {});
    vi.stubGlobal("HTMLVideoElement", class { requestVideoFrameCallback() {} });
    const start = vi.spyOn(VideoTrackFrameSource.prototype, "start").mockImplementation(() => {});
    const prepareAudio = vi.spyOn(AudioTrackFrameSource.prototype, "prepare").mockResolvedValue();
    const listener = vi.fn((_packet: RealtimeMediaFrame) => {});
    const makeFrame = () => ({ timestamp: 30_000, duration: null, displayWidth: 320, displayHeight: 180,
      close: vi.fn() }) as unknown as VideoFrame;

    await controller.setLocalMediaFrameListener(listener);
    const stream = await controller.createLocalCameraStream({
      videoFormat: defaultFormat, camera: RealtimeCamera.position(CameraPosition.front), microphone: RealtimeMicrophone.disabled,
    }, operationSignal);
    expect(start.mock.calls[0]?.[0]).toBe(stream.videoTrack?.mediaStreamTrack);
    expect(rtc.initializeCalls).toBe(0);
    const emitFirst = start.mock.calls[0]![1];
    emitFirst({ frame: makeFrame(), discontinuous: true });
    await vi.runAllTimersAsync();
    expect(listener.mock.calls[0]?.[0].content.type).toBe("video");

    const switched = await controller.switchCamera(operationSignal);
    const obsolete = makeFrame();
    emitFirst({ frame: obsolete, discontinuous: false });
    expect(obsolete.close).toHaveBeenCalledOnce();
    expect(start.mock.calls[1]?.[0]).toBe(switched.videoTrack?.mediaStreamTrack);
    start.mock.calls[1]![1]({ frame: makeFrame(), discontinuous: false });
    await vi.runAllTimersAsync();
    expect(listener.mock.calls[1]?.[0].streamID).not.toBe(listener.mock.calls[0]?.[0].streamID);
    expect(listener.mock.calls[1]?.[0].isDiscontinuous).toBe(true);
    expect(prepareAudio).not.toHaveBeenCalled();
    expect(getUserMedia.mock.calls.every(([constraints]) => !constraints.audio)).toBe(true);

    await controller.setLocalMediaFrameListener();
    expect(tracks[1]?.readyState).toBe("live");
    await controller.stopLocalCameraStream();
  });

  it("observes the microphone only during connection and drops queued audio when it disconnects", async () => {
    const { controller, tracks } = makeController();
    vi.useFakeTimers();
    vi.stubGlobal("VideoFrame", class {});
    vi.stubGlobal("HTMLVideoElement", class { requestVideoFrameCallback() {} });
    const start = vi.spyOn(VideoTrackFrameSource.prototype, "start").mockImplementation(() => {});
    const prepare = vi.spyOn(AudioTrackFrameSource.prototype, "prepare").mockResolvedValue();
    const setTrack = vi.spyOn(AudioTrackFrameSource.prototype, "setTrack").mockImplementation(() => {});
    const close = vi.spyOn(AudioTrackFrameSource.prototype, "close").mockResolvedValue();
    const listener = vi.fn((_packet: RealtimeMediaFrame) => {});

    await controller.createLocalCameraStream({
      videoFormat: defaultFormat, camera: RealtimeCamera.position(CameraPosition.front), microphone: RealtimeMicrophone.systemDefault,
    }, operationSignal);
    await controller.setLocalMediaFrameListener(listener);
    expect(start).toHaveBeenCalledOnce();
    expect(prepare).not.toHaveBeenCalled();
    await controller.prepareForConnection(operationSignal);
    expect(prepare).toHaveBeenCalledOnce();
    expect(setTrack.mock.calls[0]?.[0]).toBe(tracks[1]);
    const emitAudio = setTrack.mock.calls[0]![1];
    const packet = { data: new Uint8Array(960), sampleRate: 48000, channels: 1, samplesPerChannel: 480,
      presentationTimeStamp: 30_000, discontinuous: true };
    emitAudio(packet);
    await vi.runAllTimersAsync();
    expect(listener.mock.calls[0]?.[0]).toMatchObject({
      duration: 10_000, content: { type: "audio", frame: { data: packet.data } },
    });

    emitAudio(packet);
    await controller.releaseConnectionMedia();
    emitAudio(packet);
    await vi.runAllTimersAsync();
    expect(listener).toHaveBeenCalledOnce();
    expect(close).toHaveBeenCalledOnce();
    expect(start).toHaveBeenCalledOnce();
    expect(tracks[0]?.readyState).toBe("live");
    await controller.stopLocalCameraStream();
  });

  it("crops a portrait capture to the requested landscape track used for preview and publication", async () => {
    const { controller, rtc, getUserMedia } = makeController();
    const env = cameraRotationEnvironment();
    env.video.videoWidth = 1080;
    env.video.videoHeight = 1920;
    const source = new FakeMediaStreamTrack("video", { width: { ideal: 1080 }, height: { ideal: 1920 } });
    getUserMedia.mockResolvedValueOnce({ getTracks: () => [source as unknown as MediaStreamTrack] });
    const pending = controller.createLocalCameraStream({
      videoFormat: defaultFormat.resized(1920, 1080), camera: RealtimeCamera.position(CameraPosition.front), microphone: RealtimeMicrophone.disabled,
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
      videoFormat: defaultFormat,
      camera: RealtimeCamera.device("usb-camera"),
      microphone: microphoneDeviceId === undefined
        ? RealtimeMicrophone.systemDefault : RealtimeMicrophone.device(microphoneDeviceId),
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
      videoFormat: defaultFormat, camera: RealtimeCamera.position(CameraPosition.front), microphone: RealtimeMicrophone.disabled,
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
      videoFormat: defaultFormat, camera: RealtimeCamera.position(CameraPosition.back), microphone: RealtimeMicrophone.systemDefault,
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
    const local = await controller.createLocalCameraStream({ videoFormat: defaultFormat, camera: RealtimeCamera.position(CameraPosition.front), microphone: RealtimeMicrophone.disabled }, operationSignal);
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
    const local = await controller.createLocalCameraStream({ videoFormat: defaultFormat, camera: RealtimeCamera.position(CameraPosition.front), microphone: RealtimeMicrophone.disabled }, operationSignal);
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

  it("rotates and mirrors front-camera pixels while retaining the public format", async () => {
    const { controller, getUserMedia } = makeController();
    const env = cameraRotationEnvironment();
    const pending = controller.createLocalCameraStream({
      videoFormat: defaultFormat, camera: RealtimeCamera.position(CameraPosition.front), microphone: RealtimeMicrophone.disabled, rotation: 90,
    }, operationSignal);
    await vi.waitFor(() => expect(env.callbacks.size).toBe(1));
    env.frame();
    const stream = await pending;
    expect(getUserMedia).toHaveBeenCalledWith({ video: {
      width: { ideal: 1920 }, height: { ideal: 1080 }, frameRate: { ideal: 30 }, facingMode: { ideal: "user" },
    } });
    expect(stream.videoTrack?.mediaStreamTrack).toBe(env.output);
    expect(stream.videoTrack?.videoFormat).toMatchObject({ width: 1080, height: 1920 });
    expect(env.context.setTransform).toHaveBeenCalledWith(-1, 0, 0, 1, 540, 960);
    expect(attachPreview(stream.videoTrack!).isMirrored).toBe(false);
    await controller.stopLocalCameraStream();
  });

  it("rejects invalid rotation before capture starts", async () => {
    const { controller, rtc, getUserMedia } = makeController();
    await expect(controller.createLocalCameraStream({
      videoFormat: defaultFormat, camera: RealtimeCamera.position(CameraPosition.front), microphone: RealtimeMicrophone.disabled, rotation: 45 as any,
    }, operationSignal)).rejects.toMatchObject({ code: XmaxErrorCode.invalidConfiguration });
    expect(rtc.initializeCalls).toBe(0);
    expect(getUserMedia).not.toHaveBeenCalled();
  });
  it.each([undefined, 200, 0])("uses per-stream warmup duration %s", async (warmupMs) => {
    const { controller } = makeController();
    await controller.createLocalCameraStream({
      videoFormat: defaultFormat, camera: RealtimeCamera.position(CameraPosition.front), warmupMs,
    }, operationSignal);
    expect(controller.warmupMs).toBe(warmupMs ?? 0);
    await controller.waitForCameraWarmup(new AbortController().signal);
    expect(waitForCameraWarmup).toHaveBeenCalledTimes(warmupMs ? 1 : 0);
    await controller.stopLocalCameraStream();
    expect(controller.warmupMs).toBe(0);
  });

  it("retains the warmup duration across camera switches and restores zero for a new stream", async () => {
    const { controller } = makeController();
    const options = { videoFormat: defaultFormat, camera: RealtimeCamera.position(CameraPosition.front), microphone: RealtimeMicrophone.disabled };
    await controller.createLocalCameraStream({ ...options, warmupMs: 200 }, operationSignal);
    await controller.switchCamera(operationSignal);
    expect(controller.warmupMs).toBe(200);
    await controller.waitForCameraWarmup(new AbortController().signal);
    expect(waitForCameraWarmup).toHaveBeenCalledOnce();
    await controller.stopLocalCameraStream();
    await controller.createLocalCameraStream(options, operationSignal);
    expect(controller.warmupMs).toBe(0);
    await controller.waitForCameraWarmup(new AbortController().signal);
    expect(waitForCameraWarmup).toHaveBeenCalledOnce();
    await controller.stopLocalCameraStream();
  });

  it("keeps cancellation effective even with zero warmup", async () => {
    const { controller } = makeController();
    await controller.createLocalCameraStream({
      videoFormat: defaultFormat, camera: RealtimeCamera.position(CameraPosition.front), warmupMs: 0,
    }, operationSignal);
    const abort = new AbortController();
    abort.abort();
    await expect(controller.waitForCameraWarmup(abort.signal))
      .rejects.toMatchObject({ code: XmaxErrorCode.cancelled });
    expect(waitForCameraWarmup).not.toHaveBeenCalled();
    await controller.stopLocalCameraStream();
  });

  it("waits for custom warmup on the active captured track using the operation signal", async () => {
    const { controller } = makeController();
    const stream = await controller.createLocalCameraStream({
      videoFormat: defaultFormat, camera: RealtimeCamera.position(CameraPosition.front), warmupMs: 75,
    }, operationSignal);
    const signal = new AbortController().signal;
    await controller.waitForCameraWarmup(signal);
    expect(waitForCameraWarmup).toHaveBeenCalledWith(stream.videoTrack?.mediaStreamTrack, 75, signal);
    await controller.stopLocalCameraStream();
  });

  it("rejects exposure checks without active capture", async () => {
    const { controller } = makeController();
    await expect(controller.waitForCameraWarmup(new AbortController().signal))
      .rejects.toMatchObject({ code: XmaxErrorCode.mediaError });
    expect(waitForCameraWarmup).not.toHaveBeenCalled();
  });

  it("rejects stale warmup completion after the camera track changes", async () => {
    const { controller } = makeController();
    await controller.createLocalCameraStream({
      videoFormat: defaultFormat, camera: RealtimeCamera.position(CameraPosition.front), warmupMs: 200,
    }, operationSignal);
    let ready!: () => void;
    vi.mocked(waitForCameraWarmup).mockReturnValueOnce(new Promise<void>((resolve) => { ready = resolve; }));
    const pending = controller.waitForCameraWarmup(new AbortController().signal);
    await controller.switchCamera(operationSignal);
    ready();
    await expect(pending).rejects.toMatchObject({ code: XmaxErrorCode.cancelled });
    await controller.stopLocalCameraStream();
  });

  it("creates a local camera stream with the resolved format", async () => {
    const { controller, rtc, getUserMedia } = makeController();
    const stream = await controller.createLocalCameraStream({
      videoFormat: defaultFormat,
      camera: RealtimeCamera.position(CameraPosition.front),
      microphone: RealtimeMicrophone.disabled,
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
      camera: RealtimeCamera.position(CameraPosition.front),
      microphone: RealtimeMicrophone.disabled,
    }, operationSignal);
    await expect(
      controller.createLocalCameraStream({
        videoFormat: defaultFormat,
        camera: RealtimeCamera.position(CameraPosition.front),
        microphone: RealtimeMicrophone.disabled,
      }, operationSignal),
    ).rejects.toMatchObject({ code: XmaxErrorCode.invalidConfiguration });
  });

  it("cleans up when capture start fails", async () => {
    const { controller, rtc, getUserMedia } = makeController();
    getUserMedia.mockRejectedValueOnce(new Error("no camera"));
    await expect(
      controller.createLocalCameraStream({
        videoFormat: defaultFormat,
        camera: RealtimeCamera.position(CameraPosition.front),
        microphone: RealtimeMicrophone.disabled,
      }, operationSignal),
    ).rejects.toMatchObject({ code: XmaxErrorCode.mediaError });
    expect(controller.currentTrack).toBeUndefined();
    expect(rtc.initializeCalls).toBe(0);
  });

  it("stops the camera stream, destroys the engine and unregisters the preview binding", async () => {
    const { controller, rtc, tracks } = makeController();
    const stream = await controller.createLocalCameraStream({
      videoFormat: defaultFormat,
      camera: RealtimeCamera.position(CameraPosition.front),
      microphone: RealtimeMicrophone.disabled,
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
      camera: RealtimeCamera.position(CameraPosition.front),
      microphone: RealtimeMicrophone.disabled,
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
      camera: RealtimeCamera.position(CameraPosition.front),
      microphone: RealtimeMicrophone.disabled,
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

  it("shares mirrored front-camera pixels with preview, frame callbacks, and RTC, and switches to a native rear track", async () => {
    const { controller, env, rtc, getUserMedia, tracks } = makeController();
    const source = new FakeMediaStreamTrack("video", { width: { ideal: 720 }, height: { ideal: 1280 } });
    getUserMedia.mockResolvedValueOnce({ getTracks: () => [source as unknown as MediaStreamTrack] });
    vi.stubGlobal("VideoFrame", class {});
    vi.stubGlobal("HTMLVideoElement", class { requestVideoFrameCallback() {} });
    const observe = vi.spyOn(VideoTrackFrameSource.prototype, "start").mockImplementation(() => {});
    await controller.setLocalMediaFrameListener(vi.fn());
    const stream = await controller.createLocalCameraStream({
      videoFormat: defaultFormat,
      camera: RealtimeCamera.position(CameraPosition.front),
      microphone: RealtimeMicrophone.disabled,
    }, operationSignal);
    expect(env.canvas).toMatchObject({ width: 720, height: 1280 });
    expect(env.context.setTransform).toHaveBeenCalledWith(-1, 0, 0, 1, 360, 640);
    expect(stream.videoTrack?.mediaStreamTrack).toBe(env.output);
    expect(observe.mock.calls[0]?.[0]).toBe(env.output);

    const view = { isMirrored: true, setMediaStream: vi.fn() };
    VideoRenderRegistry.binding(stream.videoTrack!)!.attachHandler(view, "fill" as never);
    const preview = view.setMediaStream.mock.calls[0]![0] as MediaStream;
    expect(view.isMirrored).toBe(false);
    expect(preview.getTracks()).toEqual([env.output]);
    await controller.prepareForConnection(operationSignal);
    expect(rtc.setExternalMediaTracks).toHaveBeenCalledWith({ videoTrack: env.output, audioTrack: undefined, source: "camera" });

    const rear = await controller.switchCamera(operationSignal);
    expect(rear.videoTrack?.mediaStreamTrack).toBe(tracks[0]);
    expect(rtc.replaceCameraVideoTrack).toHaveBeenCalledWith(tracks[0]);
    expect(preview.getTracks()).toEqual([tracks[0]]);
    expect(observe.mock.calls[1]?.[0]).toBe(tracks[0]);
    expect(view.isMirrored).toBe(false);
    await controller.stopLocalCameraStream();
  });

  it("uses the selected device's reported camera position before checking the system default", async () => {
    const { controller, env, getUserMedia, enumerateDevices } = makeController();
    const source = new FakeMediaStreamTrack("video");
    source.getSettings = () => ({ width: 1080, height: 1920, facingMode: "environment" });
    getUserMedia.mockResolvedValueOnce({ getTracks: () => [source as unknown as MediaStreamTrack] });
    const stream = await controller.createLocalCameraStream({
      videoFormat: defaultFormat, camera: RealtimeCamera.device("rear"),
    }, operationSignal);
    expect(stream.videoTrack?.position).toBe(CameraPosition.back);
    expect(stream.videoTrack?.mediaStreamTrack).toBe(source);
    expect(env.canvas.captureStream).not.toHaveBeenCalled();
    expect(enumerateDevices).not.toHaveBeenCalled();
    await controller.stopLocalCameraStream();
  });

  it.each([
    { id: "default-camera", mirror: undefined, expected: true },
    { id: "other-camera", mirror: undefined, expected: false },
    { id: "default-camera", mirror: false, expected: false },
  ])("uses the system default to resolve unknown orientation for $id (mirror=$mirror)", async ({ id, mirror, expected }) => {
    const { controller, env, tracks, getUserMedia, enumerateDevices } = makeController();
    enumerateDevices.mockResolvedValue([
      { kind: "audioinput", deviceId: "microphone" },
      { kind: "videoinput", deviceId: "default-camera" },
      { kind: "videoinput", deviceId: "other-camera" },
    ] as MediaDeviceInfo[]);
    const stream = await controller.createLocalCameraStream({
      videoFormat: defaultFormat, camera: RealtimeCamera.device(id), mirror,
    }, operationSignal);
    expect(getUserMedia).toHaveBeenCalledWith({ video: expect.objectContaining({ deviceId: { exact: id } }) });
    expect(stream.videoTrack?.mediaStreamTrack).toBe(expected ? env.output : tracks[0]);
    expect(enumerateDevices).toHaveBeenCalledTimes(mirror === undefined ? 1 : 0);
    await controller.stopLocalCameraStream();
  });

  it("releases the acquired camera when default-device lookup is cancelled", async () => {
    const { controller, tracks, enumerateDevices } = makeController();
    enumerateDevices.mockReturnValueOnce(new Promise(() => {}));
    const operation = new AbortController();
    const pending = controller.createLocalCameraStream({
      videoFormat: defaultFormat, camera: RealtimeCamera.device("camera"),
    }, operation.signal);
    const rejected = expect(pending).rejects.toMatchObject({ code: XmaxErrorCode.cancelled });
    await vi.waitFor(() => expect(enumerateDevices).toHaveBeenCalledOnce());
    operation.abort();
    await rejected;
    expect(tracks[0]?.stop).toHaveBeenCalledOnce();
    expect(controller.currentTrack).toBeUndefined();
  });

  it.each([undefined, false, true])("mirrors an unoriented selected device only when requested (%s)", async (mirror) => {
    const { controller, env, tracks, permission } = makeController();
    permission.microphoneGranted = false;
    const stream = await controller.createLocalCameraStream({
      videoFormat: defaultFormat, camera: RealtimeCamera.device("usb-camera"), mirror,
    }, operationSignal);
    expect(stream.videoTrack?.position).toBeUndefined();
    expect(stream.videoTrack?.mediaStreamTrack).toBe(mirror ? env.output : tracks[0]);
    if (mirror) {
      expect(env.context.setTransform).toHaveBeenCalledWith(-1, 0, 0, 1, 540, 960);
    }
    await controller.stopLocalCameraStream();
  });

  it("honors explicit mirror=false on a front camera and retains it across switches", async () => {
    const { controller, env, tracks } = makeController();
    const options = { videoFormat: defaultFormat, camera: RealtimeCamera.position(CameraPosition.front), mirror: false };
    const local = await controller.createLocalCameraStream(options, operationSignal);
    expect(local.videoTrack?.mediaStreamTrack).toBe(tracks[0]);
    await controller.switchCamera(operationSignal);
    await controller.switchCamera(operationSignal);
    expect(local.videoTrack?.position).toBe(CameraPosition.front);
    expect(local.videoTrack?.mediaStreamTrack).toBe(tracks[2]);
    expect(env.canvas.captureStream).not.toHaveBeenCalled();
    await controller.stopLocalCameraStream();
  });

  it.each([-1, Infinity, NaN])("rejects invalid warmup %s before opening capture", async warmupMs => {
    const { controller, getUserMedia } = makeController();
    await expect(controller.createLocalCameraStream({
      videoFormat: defaultFormat, camera: RealtimeCamera.position(CameraPosition.front), warmupMs,
    }, operationSignal)).rejects.toMatchObject({ code: XmaxErrorCode.invalidConfiguration });
    expect(getUserMedia).not.toHaveBeenCalled();
  });
});
