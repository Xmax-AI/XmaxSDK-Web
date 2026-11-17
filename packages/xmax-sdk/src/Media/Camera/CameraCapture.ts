//
//  CameraCapture.ts
//  XmaxSDK
//
//  Author: 翁跃庭 (Yueting Weng)
//  GitHub: https://github.com/Xmax-AI/XmaxSDK-Web
//
//  Copyright (c) 2026 XMAX.AI PTE. LTD.
//

import { XmaxError, XmaxErrorCode, type XmaxErrorListener } from "../../Foundation/Errors/XmaxError";
import { CameraPosition } from "../../Foundation/Media/Camera/CameraPosition";
import type { CameraRotation } from "../../Foundation/Media/Camera/CameraRotation";
import { CameraRotationProcessor } from "../../Foundation/Media/Camera/CameraRotationProcessor";
import { waitForMediaOperation } from "../../Foundation/Media/MediaOperation";
import type { CreateLocalCameraStreamOptions } from "../../Service/Realtime/CreateLocalCameraStreamOptions";
import type { RealtimeCamera } from "../../Service/Realtime/RealtimeCamera";
import type { RealtimeVideoFormat } from "../../Service/Realtime/RealtimeVideoFormat";
import { captureDeviceTrack } from "../CaptureDeviceTrack";

type CaptureFormat = CreateLocalCameraStreamOptions["captureFormat"];

/** The time allowed to identify the system default before using the unknown-facing behavior. */
const DEFAULT_CAMERA_LOOKUP_TIMEOUT_MS = 1_000;

/** Bounds the wait for a frame in the requested orientation after trying alternate dimensions. */
const CAPTURE_ORIENTATION_RETRY_TIMEOUT_MS = 1_000;

/** Owns a browser camera track and its shared output after any crop, rotation, and mirroring. */
export class CameraCapture {

  private processed?: { processor: CameraRotationProcessor; track: MediaStreamTrack };

  private constructor(
    private readonly source: MediaStreamTrack,
    readonly position: CameraPosition | undefined,
    readonly captureFormat: CaptureFormat,
    private readonly rotation: CameraRotation,
    private readonly mirrored: boolean,
    private readonly onError: XmaxErrorListener,
  ) { }

  /** Opens the requested camera and prepares the track shared by preview and RTC. */
  static async open(
    format: RealtimeVideoFormat,
    captureFormat: CaptureFormat,
    camera: RealtimeCamera,
    rotation: CameraRotation,
    mirror: boolean | undefined,
    onError: XmaxErrorListener,
    signal: AbortSignal
  ): Promise<{ capture: CameraCapture; track: MediaStreamTrack }> {
    const source = await captureDeviceTrack("video", {
      ...CameraCapture.constraints(format, rotation, captureFormat),
      ...(camera.kind === "position"
        ? { facingMode: { ideal: camera.position === CameraPosition.front ? "user" : "environment" } }
        : { deviceId: { exact: camera.id } }),
    }, signal);
    try {
      const { facingMode } = source.getSettings();
      const resolvedPosition = facingMode === "user" ? CameraPosition.front
        : facingMode === "environment" ? CameraPosition.back
        : camera.kind === "position" ? camera.position : undefined;
      let mirrored = mirror ?? (resolvedPosition === CameraPosition.front);
      if (mirror === undefined && resolvedPosition === undefined && camera.kind === "device") {
        mirrored = await CameraCapture.isSystemDefaultCamera(
          camera.id,
          signal
        );
      }

      const capture = new CameraCapture(
        source,
        resolvedPosition,
        captureFormat,
        rotation,
        mirrored,
        onError
      );
      const track = await capture.output(format, signal);
      return { capture, track };
    } catch (error) {
      source.stop();
      throw error;
    }
  }

  /** Checks the first video input in the browser's list of available devices after capture starts. */
  private static async isSystemDefaultCamera(
    deviceId: string,
    signal: AbortSignal
  ): Promise<boolean> {
    const devices = globalThis.navigator?.mediaDevices;
    if (!deviceId || !devices?.enumerateDevices) {
      return false;
    }

    try {
      const inputs = await waitForMediaOperation(
        devices.enumerateDevices(),
        signal,
        DEFAULT_CAMERA_LOOKUP_TIMEOUT_MS,
        "Camera default-device lookup"
      );
      return inputs.find(input => input.kind === "videoinput")?.deviceId === deviceId;
    } catch (error) {
      if (signal.aborted) {
        throw error;
      }
      return false;
    }
  }

  /** Updates the active device without reacquiring it. Keeps its old constraints if preparation fails. */
  async updateFormat(format: RealtimeVideoFormat, signal: AbortSignal): Promise<MediaStreamTrack> {
    const previous = this.source.getConstraints();
    await this.source.applyConstraints({
      ...previous,
      ...CameraCapture.constraints(format, this.rotation, this.captureFormat),
    });
    try {
      return await this.output(format, signal);
    } catch (error) {
      if (this.source.readyState === "live") {
        await this.source.applyConstraints(previous).catch(() => { });
      }
      throw error;
    }
  }

  /** Releases the processed track and the physical camera. */
  stop(): void {
    this.processed?.processor.stop();
    this.processed = undefined;
    this.source.stop();
  }

  private async output(format: RealtimeVideoFormat, signal: AbortSignal): Promise<MediaStreamTrack> {
    if (signal.aborted || this.source.readyState !== "live") {
      throw new XmaxError(XmaxErrorCode.cancelled, "Camera capture is no longer active");
    }
    const { width, height, fps } = format;
    const { width: sourceWidth, height: sourceHeight } = this.source.getSettings();
    const matchesSource = this.rotation === 0 && sourceWidth && sourceHeight &&
      (this.captureFormat
        ? sourceWidth === width && sourceHeight === height
        : sourceWidth * height === sourceHeight * width);
    const outputWidth = this.mirrored && matchesSource ? sourceWidth : width;
    const outputHeight = this.mirrored && matchesSource ? sourceHeight : height;
    if (this.processed) {
      const { processor, track } = this.processed;
      await processor.updateFormat(
        outputWidth,
        outputHeight,
        fps
      );
      return track;
    }
    if (!this.mirrored && matchesSource) {
      return this.source;
    }

    const processor = new CameraRotationProcessor({
      width: outputWidth,
      height: outputHeight,
      frameRate: fps,
      rotation: this.rotation,
      mirrored: this.mirrored,
      onError: this.onError
    });
    const abort = () => processor.stop();
    signal.addEventListener("abort", abort, { once: true });
    try {
      const track = await processor.setSource(
        this.source,
        video => {
          const targetOrientation = Math.sign(width - height);
          const sourceOrientation = Math.sign(video.videoWidth - video.videoHeight);
          if (!this.captureFormat && this.rotation === 0 && targetOrientation !== 0 &&
            sourceOrientation === -targetOrientation) {
            return this.retryCaptureOrientation(video, width, height, signal);
          }
        }
      );
      this.processed = { processor, track };
      return track;
    } catch (error) {
      processor.stop();
      throw error;
    } finally {
      signal.removeEventListener("abort", abort);
    }
  }

  /** Tries a transposed capture request and waits for the requested frame orientation. */
  private async retryCaptureOrientation(
    video: HTMLVideoElement,
    width: number,
    height: number,
    signal: AbortSignal
  ): Promise<void> {
    const targetOrientation = Math.sign(width - height);
    let onResize!: () => void;
    const orientedFrame = new Promise<void>(resolve => {
      onResize = () => {
        if (video.videoWidth > 0 && video.videoHeight > 0 &&
          Math.sign(video.videoWidth - video.videoHeight) === targetOrientation) {
          resolve();
        }
      };
      video.addEventListener("resize", onResize);
    });
    try {
      const applied = this.source.applyConstraints({
        ...this.source.getConstraints(),
        width: { ideal: height },
        height: { ideal: width },
      });
      await waitForMediaOperation(
        applied.then(() => {
          onResize();
          return orientedFrame;
        }),
        signal,
        CAPTURE_ORIENTATION_RETRY_TIMEOUT_MS,
        "Camera orientation retry"
      );
    } catch (error) {
      if (signal.aborted) {
        throw error;
      }
    } finally {
      video.removeEventListener("resize", onResize);
    }
  }

  private static constraints(
    format: RealtimeVideoFormat,
    rotation: CameraRotation,
    captureFormat: CaptureFormat
  ): MediaTrackConstraints {
    const quarterTurn = rotation === 90 || rotation === 270;
    return {
      width: { ideal: captureFormat?.width ?? (quarterTurn ? format.height : format.width) },
      height: { ideal: captureFormat?.height ?? (quarterTurn ? format.width : format.height) },
      frameRate: { ideal: captureFormat?.fps ?? format.fps },
    };
  }
}
