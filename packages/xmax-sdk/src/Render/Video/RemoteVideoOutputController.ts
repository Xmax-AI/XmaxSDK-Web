//
//  RemoteVideoOutputController.ts
//  XmaxSDK
//
//  Author: 翁跃庭 (Yueting Weng)
//  GitHub: https://github.com/Xmax-AI/XmaxSDK-Web
//
//  Copyright (c) 2026 XMAX.AI PTE. LTD.
//

import { XmaxError, XmaxErrorCode } from "../../Foundation/Errors/XmaxError";
import { XmaxLogger } from "../../Foundation/Logging/XmaxLogger";
import type { RemoteMediaTracks } from "../../Foundation/Media/RemoteMediaTracks";
import {
  resolvedVideoBeautyOptions,
  type RealtimeVideoBeautyOptions,
  type RealtimeVideoBeautyErrorListener,
} from "../../Service/Realtime/RealtimeVideoBeautyOptions";
import { AgoraBeautyController } from "../Beauty/AgoraBeautyController";
import { StableVideoOutput } from "./StableVideoOutput";

/**
 * Shares result pixels across views and media observers. A canvas track is created only when beauty
 * or media observation needs it, then retained across effect changes until the result source changes.
 */
export class RemoteVideoOutputController {

  /**
   * The borrowed RTC video input.
   */
  private input?: MediaStreamTrack;

  /**
   * The current task and original audio binding.
   */
  private source?: RemoteMediaTracks;

  /**
   * The output currently supplied to all consumers.
   */
  private output?: MediaStreamTrack;

  /**
   * The stable browser output, retained even when beauty is disabled.
   */
  private bridge?: StableVideoOutput;

  /**
   * Whether this source cannot create a canvas output.
   */
  private bridgeUnavailable = false;

  /**
   * The shared, optional beauty configuration.
   */
  private options?: Readonly<Required<RealtimeVideoBeautyOptions>>;

  /**
   * The single processor shared by all result consumers.
   */
  private beauty?: AgoraBeautyController;

  /**
   * The current processor's first-output operation.
   */
  private starting?: Promise<void>;

  /**
   * Cleanup operations retained until close has released every obsolete processor.
   */
  private readonly releases = new Set<Promise<void>>();

  /**
   * The borrowed input's end listener, removed before replacement.
   */
  private inputEnded?: () => void;

  /**
   * The independent application callback for recoverable effect failures.
   */
  private errorListener?: RealtimeVideoBeautyErrorListener;

  /**
   * The processed-media receiver, independent of view attachment.
   */
  private listener?: (
    tracks?: RemoteMediaTracks
  ) => void;

  /**
   * Creates the presentation callback and replaceable browser processors.
   */
  constructor(
    private readonly onVideo: (
      track?: MediaStreamTrack
    ) => void,
    private readonly createBridge = (onOutput: (
      track: MediaStreamTrack
    ) => void, onError: (
      error: unknown
    ) => void) =>
      new StableVideoOutput(
        onOutput,
        onError
      ),
    private readonly createBeauty = (onOutput: (
      track: MediaStreamTrack
    ) => void, onError: (
      error: XmaxError
    ) => void) =>
      new AgoraBeautyController(
        onOutput,
        onError
      ),
  ) { }

  /**
   * Replaces a result input without retaining processing or callbacks from its predecessor.
   */
  setVideoTrack(
    track?: MediaStreamTrack
  ): void {
    if (this.input === track) {
      return;
    }
    if (this.inputEnded) {
      this.input?.removeEventListener?.(
        "ended",
        this.inputEnded
      );
    }
    this.input = track;
    this.inputEnded = track ? () => {
      if (this.input === track) {
        this.setVideoTrack(undefined);
      }
    } : undefined;
    if (this.inputEnded) {
      track?.addEventListener?.(
        "ended",
        this.inputEnded,
        { once: true }
      );
    }
    this.source = undefined;
    this.releaseBeauty();
    this.bridge?.dispose();
    this.bridge = undefined;
    this.bridgeUnavailable = false;
    this.output = undefined;
    this.onVideo(track);
    if (track && (this.options || this.listener)) {
      try {
        this.ensureBridge();
      } catch (error) {
        this.fallback(error);
      }
      if (this.options) {
        const configuration = this.options;
        void this.applyBeauty().catch(error => {
          if (this.input === track && this.options === configuration && XmaxError.from(error).code !== XmaxErrorCode.cancelled) {
            this.fallback(error);
          }
        });
      }
    }
    this.notify();
  }

  /**
   * Supplies task metadata and unmodified audio for processed-media observation.
   */
  setSource(
    source?: RemoteMediaTracks
  ): void {
    this.setVideoTrack(source?.videoTrack);
    this.source = source;
    this.notify();
  }

  /**
   * Replays available processed media; first output may arrive asynchronously while its bridge starts.
   */
  setListener(
    listener?: (
      tracks?: RemoteMediaTracks
    ) => void
  ): void {
    this.listener = listener;
    if (listener && this.input) {
      try {
        this.ensureBridge();
      } catch (error) {
        this.fallback(error);
      }
    }
    this.notify();
  }

  /**
   * Applies shared strengths before connection or during generation; undefined disables the effect.
   */
  async setBeauty(
    options?: RealtimeVideoBeautyOptions
  ): Promise<void> {
    const resolved = options === undefined ? undefined : resolvedVideoBeautyOptions(options);
    this.options = resolved;
    if (!resolved || Object.values(resolved).every(value => value === 0)) {
      if (this.input) {
        this.bridge?.setSource(this.input);
      }
      await this.releaseBeauty();
      return;
    }
    if (!this.input) {
      return;
    }
    try {
      this.ensureBridge();
      await this.applyBeauty();
    } catch (error) {
      if (this.options === resolved && XmaxError.from(error).code !== XmaxErrorCode.cancelled) {
        this.fallback(
          error,
          false
        );
      }
      throw XmaxError.from(error);
    }
  }

  /**
   * Replaces the runtime fallback callback; explicit configuration failures reject their promise.
   */
  setBeautyErrorListener(
    listener?: RealtimeVideoBeautyErrorListener
  ): void {
    this.errorListener = listener;
  }

  /**
   * Creates one stable track before a media observer can receive an effect-dependent source.
   */
  private ensureBridge(): void {
    if (this.bridge || !this.input) {
      return;
    }
    if (this.bridgeUnavailable) {
      throw new XmaxError(
        XmaxErrorCode.mediaError,
        "Shared result video output is unavailable"
      );
    }
    const input = this.input;
    try {
      const bridge = this.createBridge(
        track => {
          if (this.input !== input || this.bridge !== bridge) {
            return;
          }
          this.output = track;
          this.onVideo(track);
          this.notify();
        },
        error => {
          if (this.bridge !== bridge) {
            return;
          }
          this.bridge = undefined;
          this.bridgeUnavailable = true;
          bridge.dispose();
          this.output = undefined;
          this.fallback(error);
          this.onVideo(this.input);
          this.notify();
        }
      );
      this.bridge = bridge;
      bridge.setSource(input);
    } catch (error) {
      this.bridgeUnavailable = true;
      throw error;
    }
  }

  /**
   * Starts one lazy processor, retaining the latest strengths during asynchronous initialization.
   */
  private async applyBeauty(): Promise<void> {
    const input = this.input;
    const options = this.options;
    if (!input || !options || Object.values(options).every(value => value === 0)) {
      return;
    }
    if (this.beauty) {
      const current = this.beauty;
      current.update(options);
      await this.starting;
      if (this.beauty !== current || this.input !== input) {
        throw new XmaxError(
          XmaxErrorCode.cancelled,
          "Result beauty configuration was replaced"
        );
      }
      return;
    }
    const beauty = this.createBeauty(
      track => {
        if (this.beauty === beauty && this.input === input) {
          this.bridge?.setSource(track);
        }
      },
      error => {
        if (this.beauty === beauty) {
          this.fallback(error);
        }
      }
    );
    this.beauty = beauty;
    this.starting = beauty.start(
      input,
      options
    );
    await this.starting;
    if (this.beauty !== beauty || this.input !== input) {
      throw new XmaxError(
        XmaxErrorCode.cancelled,
        "Result beauty configuration was replaced"
      );
    }
  }

  /**
   * Restores raw pixels through the existing output track before reporting runtime failure.
   */
  private fallback(
    error: unknown,
    report = true
  ): void {
    const enabled = this.options !== undefined;
    this.options = undefined;
    if (this.input) {
      this.bridge?.setSource(this.input);
    }
    void this.releaseBeauty();
    if (enabled && report) {
      const resolved = XmaxError.from(error);
      XmaxLogger.render.warning(() => `Result beauty disabled; original pixels restored: ${resolved.message}`);
      try {
        void Promise.resolve(this.errorListener?.(resolved)).catch(() => { });
      } catch {
        // Application callbacks cannot terminate the result stream.
      }
    }
  }

  /**
   * Delivers the same processed video as preview while leaving original audio and task identity intact.
   */
  private notify(): void {
    const track = this.output ?? (this.bridge ? undefined : this.input);
    try {
      this.listener?.(this.source && track ? { ...this.source, videoTrack: track } : undefined);
    } catch (error) {
      XmaxLogger.render.warning(() => `Remote media track observer failed: ${XmaxError.from(error).message}`);
    }
  }

  /**
   * Invalidates a processor before releasing its owned output, isolating cleanup failures.
   */
  private async releaseBeauty(): Promise<void> {
    const beauty = this.beauty;
    this.beauty = undefined;
    this.starting = undefined;
    if (beauty) {
      const release = Promise.resolve().then(() => beauty.dispose()).catch(() => {
        XmaxLogger.render.warning(() => "Result beauty cleanup failed");
      });
      this.releases.add(release);
      void release.then(() => this.releases.delete(release));
    }
    await Promise.all(this.releases);
  }

  /**
   * Clears public configuration and observers and releases output when the manager closes.
   */
  async close(): Promise<void> {
    this.options = undefined;
    this.errorListener = undefined;
    this.listener = undefined;
    this.setVideoTrack(undefined);
    await this.releaseBeauty();
  }
}
