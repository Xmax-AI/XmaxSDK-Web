//
//  LocalVideoController.ts
//  XmaxSDK
//
//  Author: 翁跃庭 (Yueting Weng)
//  GitHub: https://github.com/Xmax-AI/XmaxSDK-Web
//
//  Copyright (c) 2026 XMAX.AI PTE. LTD.
//

import { XmaxError, XmaxErrorCode } from "../../Foundation/Errors/XmaxError";
import { XmaxLogger } from "../../Foundation/Logging/XmaxLogger";
import type { MediaServicing } from "../../Service/Media/MediaServicing";
import { RealtimeMediaStream } from "../../Service/Realtime/RealtimeMediaStream";
import type { RealtimeVideoFormat } from "../../Service/Realtime/RealtimeVideoFormat";
import { RealtimeVideoTrack } from "../../Service/Realtime/RealtimeVideoTrack";
import { StreamID } from "../../Service/Realtime/StreamID";
import { VideoRenderRegistry, type VideoRenderTarget } from "../../Service/Realtime/VideoRenderBinding";

/**
 * One file player and its audio/video output resources.
 */
interface LocalVideoSource {

  /**
   * The video element decoding the source.
   */
  video: HTMLVideoElement;

  /**
   * The Canvas holding output video frames.
   */
  canvas: HTMLCanvasElement;

  /**
   * The Canvas drawing context.
   */
  context: CanvasRenderingContext2D;

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
   * The SDK video track associated with the source.
   */
  track?: RealtimeVideoTrack;

  /**
   * The browser media stream produced by this source.
   */
  stream?: MediaStream;

  /**
   * The audio context routing file audio.
   */
  audioContext?: AudioContext;

  /**
   * The node reading audio from the source element.
   */
  audioSource?: MediaElementAudioSourceNode;

  /**
   * The destination converting Web Audio output to a media track.
   */
  audioDestination?: MediaStreamAudioDestinationNode;

  /**
   * The timer drawing subsequent video frames.
   */
  drawTimer?: ReturnType<typeof setInterval>;

  /**
   * The media-processing failure callback.
   */
  onError?: () => void;
}

/**
 * Decodes local files into Canvas video and Web Audio tracks without owning RTC publication. One player
 * drives both tracks; preview remains muted. Preparation pauses on the first frame until generation
 * starts.
 */
export class LocalVideoController {

  /**
   * The current file source, including preparation state.
   */
  private source?: LocalVideoSource;

  /**
   * The runtime media-failure callback.
   */
  private readonly onError: (
    error: XmaxError
  ) => void;

  /**
   * Creates a file-video controller without allocating browser resources.
   */
  constructor(
    onError: (
      error: XmaxError
    ) => void = () => { }
  ) {
    this.onError = onError;
  }

  /**
   * Whether a file source exists, including a preparing player.
   */
  get isActive(): boolean {
    return this.source !== undefined;
  }

  /**
   * The prepared local video track.
   */
  get currentTrack(): RealtimeVideoTrack | undefined {
    return this.source?.track;
  }

  /**
   * The file-audio output, absent when disabled and silent for files without an audio track.
   */
  get audioTrack(): MediaStreamTrack | undefined {
    return this.source?.audioDestination?.stream.getAudioTracks()[0];
  }

  /**
   * Validates and prepares file media; call directly from a user gesture to unlock playback.
   */
  async create(
    options: {
      file: Blob;
      videoFormat: RealtimeVideoFormat;
      loop?: boolean;
      includeAudio?: boolean;
    },
    mediaService: MediaServicing,
    signal: AbortSignal
  ): Promise<RealtimeMediaStream> {
    if (this.source) {
      throw new XmaxError(
        XmaxErrorCode.invalidConfiguration,
        "Close the current local video before creating another one"
      );
    }
    if (!(options.file instanceof Blob) || options.file.size === 0) {
      throw new XmaxError(
        XmaxErrorCode.invalidConfiguration,
        "Local video requires a non-empty File or Blob"
      );
    }
    options.videoFormat.validate();
    if (signal.aborted) {
      throw this.cancelled();
    }
    if (typeof document === "undefined") {
      throw new XmaxError(
        XmaxErrorCode.mediaError,
        "Local video requires a browser"
      );
    }

    const video = document.createElement("video");
    const canvas = document.createElement("canvas");
    const context = canvas.getContext("2d");
    if (!context || typeof canvas.captureStream !== "function") {
      throw new XmaxError(
        XmaxErrorCode.mediaError,
        "Canvas video capture is unavailable"
      );
    }
    const source: LocalVideoSource = {
      video,
      canvas,
      context,
      url: URL.createObjectURL(options.file),
      abort: new AbortController(),
      targets: new Set(),
    };
    this.source = source;

    try {
      video.playsInline = true;
      video.loop = options.loop ?? true;
      video.preload = "auto";
      video.volume = 1;
      video.muted = options.includeAudio === false;
      if (options.includeAudio !== false) {
        if (typeof AudioContext === "undefined") {
          throw new XmaxError(
            XmaxErrorCode.mediaError,
            "Web Audio is unavailable; disable file audio or use a supported browser"
          );
        }
        const audio = new AudioContext();
        source.audioContext = audio;
        source.audioSource = audio.createMediaElementSource(video);
        source.audioDestination = audio.createMediaStreamDestination();
        source.audioSource.connect(source.audioDestination);
        // Do not connect speakers; muted preview must not change the original audio sent to RTC.
      }
      video.src = source.url;

      // Unlock the player and audio context within the user gesture, then return to the first frame until generation starts.
      const resume = source.audioContext?.resume();
      const playing = this.play(
        source,
        signal
      );
      await this.wait(
        source,
        Promise.all([resume, playing]),
        signal
      );
      video.pause();
      if (!video.videoWidth || !video.videoHeight || !Number.isFinite(video.duration) || video.duration <= 0) {
        throw new XmaxError(
          XmaxErrorCode.mediaError,
          "The file has no playable finite video stream"
        );
      }
      const size = mediaService.resolveMediaSize(
        {
          width: video.videoWidth,
          height: video.videoHeight
        },
        "video"
      );
      const format = options.videoFormat.resized(
        size.width,
        size.height
      );
      canvas.width = size.width;
      canvas.height = size.height;
      await this.rewind(
        source,
        signal
      );

      this.draw(source);
      source.stream = canvas.captureStream(format.fps);
      const nativeTrack = source.stream.getVideoTracks()[0];
      if (!nativeTrack) {
        throw new XmaxError(
          XmaxErrorCode.mediaError,
          "Canvas did not provide a video track"
        );
      }
      const track = new RealtimeVideoTrack({
        id: "local-video",
        videoFormat: format
      });
      track.mediaStreamTrack = nativeTrack;
      source.track = track;
      this.draw(source);
      // Continue emitting the still frame while paused or ended so publication can negotiate video before playback starts.
      source.drawTimer = setInterval(
        () => {
          if (this.source !== source) {
            return;
          }
          try {
            this.draw(source);
          } catch {
            this.handleError(source);
          }
        },
        1000 / format.fps
      );
      source.onError = () => this.handleError(source);
      video.addEventListener(
        "error",
        source.onError
      );

      VideoRenderRegistry.register(
        track,
        {
          attachHandler: (view) => {
            view.isMirrored = false;
            view.setMediaStream(source.stream!);
            source.targets.add(view);
          },
          detachHandler: (view) => {
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
      await this.stop();
      throw XmaxError.from(error);
    }
  }

  /**
   * Starts both tracks from the file beginning after start signaling, without waiting for a remote
   * frame.
   */
  async start(
    signal: AbortSignal
  ): Promise<void> {
    const source = this.source;
    if (!source?.track) {
      throw new XmaxError(
        XmaxErrorCode.invalidConfiguration,
        "Local video is not prepared"
      );
    }
    if (signal.aborted) {
      throw this.cancelled();
    }
    try {
      await this.rewind(
        source,
        signal
      );
      await this.wait(
        source,
        Promise.all([source.audioContext?.resume(), this.play(
          source,
          signal
        )]),
        signal
      );
    } catch (error) {
      source.video.pause();
      throw error;
    }
  }

  /**
   * Pauses file audio/video while retaining preview; restarting generation rewinds the file.
   */
  pause(): void {
    this.source?.video.pause();
  }

  /**
   * Releases the player, preview, timer, tracks, audio context, and Blob URL.
   */
  async stop(): Promise<void> {
    const source = this.source;
    this.source = undefined;
    if (!source) {
      return;
    }
    source.abort.abort();
    clearInterval(source.drawTimer);
    if (source.onError) {
      source.video.removeEventListener(
        "error",
        source.onError
      );
    }
    if (source.track) {
      VideoRenderRegistry.unregister(source.track);
      source.track.mediaStreamTrack = undefined;
    }
    for (const view of source.targets) {
      try {
        view.setMediaStream(null);
      } catch {
        // One failed view detachment must not prevent other resource cleanup.
      }
    }
    source.targets.clear();
    source.video.pause();
    source.video.removeAttribute("src");
    source.video.load();
    source.stream?.getTracks().forEach(track => track.stop());
    source.audioDestination?.stream.getTracks().forEach(track => track.stop());
    source.audioSource?.disconnect();
    source.audioDestination?.disconnect();
    URL.revokeObjectURL(source.url);
    await source.audioContext?.close().catch(() => { });
  }

  /**
   * Reports actionable playback rejection and pauses obsolete playback that completes after closure.
   */
  private play(
    source: LocalVideoSource,
    signal: AbortSignal
  ): Promise<void> {
    return source.video.play().then(() => {
      if (this.source !== source || source.abort.signal.aborted || signal.aborted) {
        source.video.pause();
        throw this.cancelled();
      }
    }).catch(error => {
      if (error instanceof XmaxError) {
        throw error;
      }
      throw new XmaxError(
        XmaxErrorCode.mediaError,
        "Cannot play local video; call from a user click and use a browser-supported video codec"
      );
    });
  }

  /**
   * Waits for rewind so restarted generation begins with the first frame rather than cached video.
   */
  private async rewind(
    source: LocalVideoSource,
    signal: AbortSignal
  ): Promise<void> {
    if (source.video.currentTime === 0) {
      return;
    }
    let seeked!: () => void;
    const ready = new Promise<void>(resolve => {
      seeked = resolve;
    });
    source.video.addEventListener(
      "seeked",
      seeked,
      { once: true }
    );
    try {
      source.video.currentTime = 0;
      await this.wait(
        source,
        ready,
        signal
      );
    } finally {
      source.video.removeEventListener(
        "seeked",
        seeked
      );
    }
  }

  /**
   * Bounds browser preparation and playback to ten seconds while observing closure, cancellation, and
   * decode failure.
   */
  private wait(
    source: LocalVideoSource,
    operation: Promise<unknown>,
    signal: AbortSignal
  ): Promise<void> {
    return new Promise((
      resolve,
      reject
    ) => {
      const finish = (error?: unknown) => {
        clearTimeout(timer);
        signal.removeEventListener(
          "abort",
          abort
        );
        source.abort.signal.removeEventListener(
          "abort",
          abort
        );
        source.video.removeEventListener(
          "error",
          failed
        );
        if (error) {
          reject(error);
        } else {
          resolve();
        }
      };
      const abort = () => finish(this.cancelled());
      const failed = () => finish(new XmaxError(
        XmaxErrorCode.mediaError,
        "The browser cannot decode this video file"
      ));
      const timer = setTimeout(
        () => finish(new XmaxError(
          XmaxErrorCode.timeout,
          "Local video preparation timed out; start from a user click and check the video codec"
        )),
        10_000
      );
      signal.addEventListener(
        "abort",
        abort,
        { once: true }
      );
      source.abort.signal.addEventListener(
        "abort",
        abort,
        { once: true }
      );
      source.video.addEventListener(
        "error",
        failed,
        { once: true }
      );
      operation.then(
        () => finish(),
        finish
      );
      if (signal.aborted || source.abort.signal.aborted) {
        abort();
      }
    });
  }

  /**
   * Scales the entire image to resolved media dimensions without generation padding or
   * device-orientation transposition.
   */
  private draw(
    source: LocalVideoSource
  ): void {
    const { video, canvas, context } = source;
    if (video.readyState < 2) {
      return;
    }
    context.fillStyle = "black";
    context.fillRect(
      0,
      0,
      canvas.width,
      canvas.height
    );
    context.drawImage(
      video,
      0,
      0,
      canvas.width,
      canvas.height
    );
  }

  /**
   * Stops media advancement and reports one runtime decode or drawing failure.
   */
  private handleError(
    source: LocalVideoSource
  ): void {
    if (this.source !== source || source.drawTimer === undefined) {
      return;
    }
    clearInterval(source.drawTimer);
    source.drawTimer = undefined;
    source.video.pause();
    XmaxLogger.realtime.warning(() => "本地视频解码失败 (Local Video Decode Failed)");
    this.onError(new XmaxError(
      XmaxErrorCode.mediaError,
      "Local video decoding failed"
    ));
  }

  /**
   * Creates the standard file-media cancellation error.
   */
  private cancelled(): XmaxError {
    return new XmaxError(
      XmaxErrorCode.cancelled,
      "Local video operation was cancelled"
    );
  }
}
