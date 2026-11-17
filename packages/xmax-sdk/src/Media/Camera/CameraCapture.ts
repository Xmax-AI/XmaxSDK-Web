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
import type { RealtimeVideoFormat } from "../../Service/Realtime/RealtimeVideoFormat";
import { captureDeviceTrack } from "../CaptureDeviceTrack";

/** Owns a browser camera track and, when needed, its cropped and rotated output. */
export class CameraCapture {

  private processed?: { processor: CameraRotationProcessor; track: MediaStreamTrack };

  private constructor(
    readonly source: MediaStreamTrack,
    private readonly rotation: CameraRotation,
    private readonly onError: XmaxErrorListener,
  ) { }

  /** Opens the requested camera and prepares the track shared by preview and RTC. */
  static async open(
    format: RealtimeVideoFormat,
    position: CameraPosition,
    rotation: CameraRotation,
    onError: XmaxErrorListener,
    signal: AbortSignal,
    deviceId?: string,
  ): Promise<{ capture: CameraCapture; track: MediaStreamTrack }> {
    const source = await captureDeviceTrack("video", {
      ...CameraCapture.constraints(format, rotation),
      ...(deviceId === undefined
        ? { facingMode: { ideal: position === CameraPosition.front ? "user" : "environment" } }
        : { deviceId: { exact: deviceId } }),
    }, signal);
    const capture = new CameraCapture(source, rotation, onError);
    try {
      const track = await capture.output(format, signal);
      return { capture, track };
    } catch (error) {
      capture.stop();
      throw error;
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
    if (this.processed) {
      const { processor, track } = this.processed;
      await processor.updateFormat(width, height, fps);
      return track;
    }
    const settings = this.source.getSettings();
    if (this.rotation === 0 && settings.width && settings.height && settings.width * height === settings.height * width) {
      return this.source;
    }

    const processor = new CameraRotationProcessor({ width, height, frameRate: fps, rotation: this.rotation, onError: this.onError });
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
