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
import type { RealtimeCamera } from "../../Service/Realtime/RealtimeCamera";
import type { RealtimeVideoFormat } from "../../Service/Realtime/RealtimeVideoFormat";
import { captureDeviceTrack } from "../CaptureDeviceTrack";

/** The time allowed to identify the system default before using the unknown-facing behavior. */
const DEFAULT_CAMERA_LOOKUP_TIMEOUT_MS = 1_000;

/** Owns a browser camera track and its shared output after any crop, rotation, and mirroring. */
export class CameraCapture {

  private processed?: { processor: CameraRotationProcessor; track: MediaStreamTrack };

  private constructor(
    private readonly source: MediaStreamTrack,
    readonly position: CameraPosition | undefined,
    private readonly rotation: CameraRotation,
    private readonly mirrored: boolean,
    private readonly onError: XmaxErrorListener,
  ) { }

  /** Opens the requested camera and prepares the track shared by preview and RTC. */
  static async open(
    format: RealtimeVideoFormat,
    camera: RealtimeCamera,
    rotation: CameraRotation,
    mirror: boolean | undefined,
    onError: XmaxErrorListener,
    signal: AbortSignal
  ): Promise<{ capture: CameraCapture; track: MediaStreamTrack }> {
    const source = await captureDeviceTrack("video", {
      ...CameraCapture.constraints(format, rotation),
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
    await this.source.applyConstraints({ ...previous, ...CameraCapture.constraints(format, this.rotation) });
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
      sourceWidth * height === sourceHeight * width;
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
      const track = await processor.setSource(this.source);
      this.processed = { processor, track };
      return track;
    } catch (error) {
      processor.stop();
      throw error;
    } finally {
      signal.removeEventListener("abort", abort);
    }
  }

  private static constraints(format: RealtimeVideoFormat, rotation: CameraRotation): MediaTrackConstraints {
    const quarterTurn = rotation === 90 || rotation === 270;
    return {
      width: { ideal: quarterTurn ? format.height : format.width },
      height: { ideal: quarterTurn ? format.width : format.height },
      frameRate: { ideal: format.fps },
    };
  }
}
