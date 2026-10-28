//
//  LocalImageController.ts
//  XmaxSDK
//
//  Author: 翁跃庭 (Yueting Weng)
//  GitHub: https://github.com/Xmax-AI/XmaxSDK-Web
//
//  Copyright (c) 2026 XMAX.AI PTE. LTD.
//

import { XmaxError, XmaxErrorCode } from "../../Foundation/Errors/XmaxError";
import type { MediaServicing } from "../../Service/Media/MediaServicing";
import { RealtimeMediaStream } from "../../Service/Realtime/RealtimeMediaStream";
import type { RealtimeVideoFormat } from "../../Service/Realtime/RealtimeVideoFormat";
import { RealtimeVideoTrack } from "../../Service/Realtime/RealtimeVideoTrack";
import { StreamID } from "../../Service/Realtime/StreamID";
import { VideoRenderRegistry, type VideoRenderTarget } from "../../Service/Realtime/VideoRenderBinding";

/**
 * Image decoding, still-video output, and preview resources.
 */
interface LocalImageSource {

  /**
   * The element decoding the source image.
   */
  image: HTMLImageElement;

  /**
   * The Canvas holding still-video frames.
   */
  canvas: HTMLCanvasElement;

  /**
   * The source Blob URL, revoked on release.
   */
  url: string;

  /**
   * The controller cancelling media preparation and waits.
   */
  abort: AbortController;

  /**
   * The rendering targets bound to this source.
   */
  targets: Set<VideoRenderTarget>;

  /**
   * The browser stream produced by the source.
   */
  stream?: MediaStream;

  /**
   * The SDK video track associated with this source.
   */
  track?: RealtimeVideoTrack;

  /**
   * The timer refreshing the static output frame.
   */
  timer?: ReturnType<typeof setInterval>;

  /**
   * The callback releasing resources when output ends.
   */
  onEnded?: () => void;
}

/**
 * Scales a local image proportionally into a silent still-video stream without uploads or device
 * capture.
 */
export class LocalImageController {

  /**
   * The active image source, including pending decoding.
   */
  private source?: LocalImageSource;

  /**
   * Creates an image controller with a runtime failure callback.
   */
  constructor(
    private readonly onError: (
      error: XmaxError
    ) => void
  ) { }

  /**
   * Whether an image source is preparing or available.
   */
  get isActive(): boolean {
    return this.source !== undefined;
  }

  /**
   * The prepared still-image video track.
   */
  get currentTrack(): RealtimeVideoTrack | undefined {
    return this.source?.track;
  }

  /**
   * Decodes the image and continuously outputs its still snapshot, releasing resources on failure or
   * cancellation.
   */
  async create(
    options: {
      file: Blob;
      videoFormat: RealtimeVideoFormat;
    },
    mediaService: MediaServicing,
    signal: AbortSignal
  ): Promise<RealtimeMediaStream> {
    if (this.source) {
      throw new XmaxError(
        XmaxErrorCode.invalidConfiguration,
        "Close the current local image before creating another one"
      );
    }
    if (!(options.file instanceof Blob) || options.file.size === 0) {
      throw new XmaxError(
        XmaxErrorCode.invalidConfiguration,
        "Local image requires a non-empty File or Blob"
      );
    }
    options.videoFormat.validate();
    if (signal.aborted) {
      throw this.cancelled();
    }
    if (typeof document === "undefined") {
      throw new XmaxError(
        XmaxErrorCode.mediaError,
        "Local image requires a browser"
      );
    }

    const image = document.createElement("img");
    const canvas = document.createElement("canvas");
    const context = canvas.getContext("2d");
    if (!context || typeof canvas.captureStream !== "function") {
      throw new XmaxError(
        XmaxErrorCode.mediaError,
        "Canvas video capture is unavailable"
      );
    }
    const source: LocalImageSource = {
      image,
      canvas,
      url: URL.createObjectURL(options.file),
      abort: new AbortController(),
      targets: new Set(),
    };
    this.source = source;

    try {
      await this.load(
        source,
        signal
      );
      if (signal.aborted || this.source !== source) {
        throw this.cancelled();
      }
      if (!image.naturalWidth || !image.naturalHeight) {
        throw new XmaxError(
          XmaxErrorCode.mediaError,
          "The image has no valid dimensions"
        );
      }

      const size = mediaService.resolveMediaSize(
        {
          width: image.naturalWidth,
          height: image.naturalHeight
        },
        "image"
      );
      const format = options.videoFormat.resized(
        size.width,
        size.height
      );
      canvas.width = size.width;
      canvas.height = size.height;

      // Draw the decoded image once; animated inputs must not advance after the snapshot.
      context.fillStyle = "black";
      context.fillRect(
        0,
        0,
        canvas.width,
        canvas.height
      );
      context.drawImage(
        image,
        0,
        0,
        canvas.width,
        canvas.height
      );
      source.stream = canvas.captureStream(format.fps);
      const nativeTrack = source.stream.getVideoTracks()[0] as CanvasCaptureMediaStreamTrack | undefined;
      if (!nativeTrack || nativeTrack.readyState !== "live") {
        throw new XmaxError(
          XmaxErrorCode.mediaError,
          "Canvas did not provide a live video track"
        );
      }
      const track = new RealtimeVideoTrack({
        id: "local-image",
        videoFormat: format
      });
      track.mediaStreamTrack = nativeTrack;
      source.track = track;

      const refresh = () => {
        // Refresh the Canvas snapshot rather than redrawing the source image and advancing animated content.
        context.drawImage(
          canvas,
          0,
          0
        );
        if (typeof nativeTrack.requestFrame === "function") {
          nativeTrack.requestFrame();
        }
      };
      refresh();
      source.timer = setInterval(
        () => {
          if (this.source !== source) {
            return;
          }
          try {
            refresh();
          } catch {
            this.handleError(source);
          }
        },
        1000 / format.fps
      );
      source.onEnded = () => this.handleError(source);
      nativeTrack.addEventListener(
        "ended",
        source.onEnded
      );

      VideoRenderRegistry.register(
        track,
        {
          attachHandler: view => {
            if (this.source !== source) {
              return;
            }
            view.isMirrored = false;
            view.setMediaStream(source.stream!);
            source.targets.add(view);
          },
          detachHandler: view => {
            source.targets.delete(view);
            view.setMediaStream(null);
          },
        }
      );
      return new RealtimeMediaStream({
        id: StreamID.local,
        videoTrack: track
      });
    } catch (error) {
      if (this.source === source) {
        this.stop();
      }
      throw XmaxError.from(error);
    }
  }

  /**
   * Cancels decoding, clears preview, and releases tracks, timers, and the Blob URL.
   */
  stop(): void {
    const source = this.source;
    this.source = undefined;
    if (!source) {
      return;
    }

    source.abort.abort();
    clearInterval(source.timer);
    if (source.track) {
      VideoRenderRegistry.unregister(source.track);
      if (source.onEnded) {
        source.track.mediaStreamTrack?.removeEventListener(
          "ended",
          source.onEnded
        );
      }
      source.track.mediaStreamTrack = undefined;
    }
    for (const view of source.targets) {
      try {
        view.setMediaStream(null);
      } catch {
        // A view failure must not prevent media-resource cleanup.
      }
    }
    source.targets.clear();
    source.stream?.getTracks().forEach(track => track.stop());
    source.image.removeAttribute("src");
    URL.revokeObjectURL(source.url);
    source.canvas.width = 0;
    source.canvas.height = 0;
  }

  /**
   * Waits for browser image decoding with stop, cancellation, and timeout support.
   */
  private load(
    source: LocalImageSource,
    signal: AbortSignal
  ): Promise<void> {
    return new Promise((
      resolve,
      reject
    ) => {
      const finish = (error?: XmaxError) => {
        clearTimeout(timer);
        source.image.removeEventListener(
          "load",
          loaded
        );
        source.image.removeEventListener(
          "error",
          failed
        );
        signal.removeEventListener(
          "abort",
          aborted
        );
        source.abort.signal.removeEventListener(
          "abort",
          aborted
        );
        if (error) {
          reject(error);
        } else {
          resolve();
        }
      };
      const loaded = () => finish();
      const failed = () => finish(new XmaxError(
        XmaxErrorCode.mediaError,
        "The browser cannot decode this image file"
      ));
      const aborted = () => finish(this.cancelled());
      const timer = setTimeout(
        () => finish(new XmaxError(
          XmaxErrorCode.timeout,
          "Local image preparation timed out"
        )),
        10_000
      );
      source.image.addEventListener(
        "load",
        loaded,
        { once: true }
      );
      source.image.addEventListener(
        "error",
        failed,
        { once: true }
      );
      signal.addEventListener(
        "abort",
        aborted,
        { once: true }
      );
      source.abort.signal.addEventListener(
        "abort",
        aborted,
        { once: true }
      );
      if (signal.aborted || source.abort.signal.aborted) {
        aborted();
      } else {
        source.image.src = source.url;
      }
    });
  }

  /**
   * Stops refresh and reports one output failure, leaving resource cleanup to the media lifecycle.
   */
  private handleError(
    source: LocalImageSource
  ): void {
    if (this.source !== source || source.timer === undefined) {
      return;
    }
    clearInterval(source.timer);
    source.timer = undefined;
    this.onError(new XmaxError(
      XmaxErrorCode.mediaError,
      "Local image video output failed"
    ));
  }

  /**
   * Creates a standard image-operation cancellation error.
   */
  private cancelled(): XmaxError {
    return new XmaxError(
      XmaxErrorCode.cancelled,
      "Local image operation was cancelled"
    );
  }
}
