//
//  ExternalVideoController.ts
//  XmaxSDK
//
//  Author: 翁跃庭 (Yueting Weng)
//  GitHub: https://github.com/Xmax-AI/XmaxSDK-Web
//
//  Copyright (c) 2026 XMAX.AI PTE. LTD.
//

import { XmaxError, XmaxErrorCode } from "../../Foundation/Errors/XmaxError";
import { XmaxLogger } from "../../Foundation/Logging/XmaxLogger";
import { ExternalAudioFrameSource } from "../../Foundation/Media/Audio/ExternalAudioFrameSource";
import { waitForMediaOperation } from "../../Foundation/Media/MediaOperation";
import type { MediaServicing } from "../../Service/Media/MediaServicing";
import { RealtimeMediaStream } from "../../Service/Realtime/RealtimeMediaStream";
import { RealtimeVideoTrack } from "../../Service/Realtime/RealtimeVideoTrack";
import { StreamID } from "../../Stream/StreamID";
import { type VideoRenderTarget } from "../../Render/Video/VideoRenderBinding";
import { VideoRenderRegistry } from "../../Render/Video/VideoRenderRegistry";
import { ExternalVideoFrameSink } from "./ExternalVideoFrameSink";
import type { RealtimeExternalVideoSource } from "./RealtimeExternalVideoSource";

/**
 * An external-source binding and its SDK-owned output resources.
 */
interface ExternalBinding {

  /**
   * The source owned by your app.
   */
  source: RealtimeExternalVideoSource;

  /**
   * Cancels setup and asynchronous work for this binding.
   */
  abort: AbortController;

  /**
   * The Canvas holding SDK video output.
   */
  canvas: HTMLCanvasElement;

  /**
   * The SDK-owned stream captured from the output Canvas.
   */
  stream: MediaStream;

  /**
   * The video track exposed for preview and publication.
   */
  track: RealtimeVideoTrack;

  /**
   * The PCM output graph created when the source declares audio.
   */
  audio?: ExternalAudioFrameSource;

  /**
   * The frame receiver invalidated when this binding ends.
   */
  sink?: ExternalVideoFrameSink;

  /**
   * The views previewing this binding.
   */
  targets: Set<VideoRenderTarget>;

  /**
   * The output-track end listener removed during cleanup.
   */
  onEnded?: () => void;
}

/**
 * Binds, previews, and releases external frame sources without owning app capture devices or original
 * frames.
 */
export class ExternalVideoController {

  /**
   * The active or preparing binding, preventing concurrent replacement.
   */
  private binding?: ExternalBinding;

  /**
   * Creates a controller with a terminal source-failure callback.
   */
  constructor(
    private readonly onError: (
      error: XmaxError
    ) => void
  ) { }

  /**
   * Whether a source is preparing or bound.
   */
  get isActive(): boolean {
    return this.binding !== undefined;
  }

  /**
   * The SDK video track available for preview and publication.
   */
  get currentTrack(): RealtimeVideoTrack | undefined {
    return this.binding?.track;
  }

  /**
   * The publishable audio track created when the source declares audio.
   */
  get audioTrack(): MediaStreamTrack | undefined {
    return this.binding?.audio?.track;
  }

  /**
   * Prepares output and calls source.start without waiting for a frame, stopping the binding on
   * cancellation or failure.
   */
  async create(
    source: RealtimeExternalVideoSource,
    media: MediaServicing,
    signal: AbortSignal
  ): Promise<RealtimeMediaStream> {
    if (this.binding) {
      throw new XmaxError(
        XmaxErrorCode.invalidConfiguration,
        "Close the current external frame source first"
      );
    }
    if (!source || typeof source.start !== "function" || typeof source.stop !== "function" ||
      (source.hasAudio !== undefined && typeof source.hasAudio !== "boolean")) {
      throw new XmaxError(
        XmaxErrorCode.invalidConfiguration,
        "A valid external video source is required"
      );
    }

    source.videoFormat.validate();
    const size = media.resolveMediaSize(
      source.videoFormat,
      "external"
    );
    const sourceFormat = source.videoFormat.resized(
      source.videoFormat.width,
      source.videoFormat.height
    );
    const format = sourceFormat.resized(
      size.width,
      size.height
    );
    if (signal.aborted) {
      throw new XmaxError(
        XmaxErrorCode.cancelled,
        "External source creation cancelled"
      );
    }
    if (typeof document === "undefined" || typeof VideoFrame === "undefined") {
      throw new XmaxError(
        XmaxErrorCode.mediaError,
        "External frames require a browser with VideoFrame support"
      );
    }

    const canvas = document.createElement("canvas");
    canvas.width = size.width;
    canvas.height = size.height;
    const context = canvas.getContext(
      "2d",
      { alpha: false }
    );
    if (!context || typeof canvas.captureStream !== "function") {
      throw new XmaxError(
        XmaxErrorCode.mediaError,
        "Canvas video capture is unavailable"
      );
    }
    const stream = canvas.captureStream(format.fps);
    const native = stream.getVideoTracks()[0] as CanvasCaptureMediaStreamTrack | undefined;
    if (!native || native.readyState !== "live") {
      stream.getTracks().forEach(track => track.stop());
      throw new XmaxError(
        XmaxErrorCode.mediaError,
        "Canvas did not provide a live external video track"
      );
    }

    const track = new RealtimeVideoTrack({
      id: "external-frames",
      videoFormat: format
    });
    track.mediaStreamTrack = native;
    const binding: ExternalBinding = {
      source,
      canvas,
      stream,
      track,
      abort: new AbortController(),
      targets: new Set()
    };
    this.binding = binding;

    const abort = () => binding.abort.abort();
    signal.addEventListener(
      "abort",
      abort,
      { once: true }
    );
    if (signal.aborted) {
      abort();
    }

    try {
      if (source.hasAudio) {
        binding.audio = new ExternalAudioFrameSource();
        await binding.audio.prepare(
          binding.abort.signal,
          error => {
            if (binding.sink) {
              binding.sink.reportError(error);
            } else {
              binding.abort.abort();
              if (this.binding === binding) {
                this.onError(error);
              }
            }
          }
        );
      }

      const sink = new ExternalVideoFrameSink(
        format,
        sourceFormat,
        context,
        native,
        binding.audio,
        error => {
          if (this.binding === binding) {
            this.onError(error);
          }
        }
      );
      binding.sink = sink;
      binding.onEnded = () => sink.reportError(new XmaxError(
        XmaxErrorCode.mediaError,
        "External video output ended"
      ));
      native.addEventListener(
        "ended",
        binding.onEnded
      );

      VideoRenderRegistry.register(
        track,
        {
          attachHandler: view => {
            if (this.binding !== binding) {
              return;
            }
            view.isMirrored = false;
            view.setMediaStream(stream);
            binding.targets.add(view);
          },
          detachHandler: view => {
            binding.targets.delete(view);
            view.setMediaStream(null);
          },
        }
      );

      await waitForMediaOperation(
        Promise.resolve(source.start(sink)),
        binding.abort.signal,
        10_000,
        "External source startup"
      );
      if (this.binding !== binding || binding.abort.signal.aborted || !sink.isRequestingFrames) {
        throw new XmaxError(
          XmaxErrorCode.cancelled,
          "External source is no longer attached"
        );
      }

      return new RealtimeMediaStream({
        id: StreamID.local,
        videoTrack: track
      });
    } catch (error) {
      if (this.binding === binding) {
        await this.stop();
      }
      throw XmaxError.from(error);
    } finally {
      signal.removeEventListener(
        "abort",
        abort
      );
    }
  }

  /**
   * Consumes audio only while RTC publication is active.
   */
  setAudioPublished(
    published: boolean
  ): void {
    this.binding?.audio?.setPublished(published && this.binding.sink?.isRequestingFrames === true);
  }

  /**
   * Synchronously rejects further frames before connection or media resources are released.
   */
  invalidate(): void {
    this.binding?.sink?.invalidate();
    this.binding?.abort.abort();
  }

  /**
   * Invalidates the sink and releases SDK output before a bounded wait for the app's stop callback.
   */
  async stop(): Promise<void> {
    const binding = this.binding;
    if (!binding) {
      return;
    }
    this.binding = undefined;
    binding.abort.abort();
    binding.sink?.invalidate();
    const native = binding.track.mediaStreamTrack;
    if (binding.onEnded) {
      native?.removeEventListener(
        "ended",
        binding.onEnded
      );
    }
    VideoRenderRegistry.unregister(binding.track);
    binding.track.mediaStreamTrack = undefined;
    for (const view of binding.targets) {
      try {
        view.setMediaStream(null);
      } catch {
        // One view's failure must not prevent cleanup of other previews or media resources.
      }
    }
    binding.targets.clear();
    binding.stream.getTracks().forEach(track => track.stop());
    binding.canvas.width = 0;
    binding.canvas.height = 0;
    const results = await Promise.allSettled([
      binding.audio?.close(),
      waitForMediaOperation(
        Promise.resolve().then(() => binding.source.stop()),
        new AbortController().signal,
        2000,
        "External source stop"
      ),
    ]);
    for (const result of results) {
      if (result.status === "rejected") {
        XmaxLogger.media.warning(() => `External source cleanup failed: ${XmaxError.from(result.reason).message}`);
      }
    }
  }
}
