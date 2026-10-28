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
import type { MediaServicing } from "../../Service/Media/MediaServicing";
import { RealtimeMediaStream } from "../../Service/Realtime/RealtimeMediaStream";
import type { RealtimeVideoFormat } from "../../Service/Realtime/RealtimeVideoFormat";
import { RealtimeVideoTrack } from "../../Service/Realtime/RealtimeVideoTrack";
import { StreamID } from "../../Service/Realtime/StreamID";

/**
 * Owns an external-video clone without capturing devices, processing pixels, or creating preview.
 */
export class ExternalVideoController {

  /**
   * The SDK track associated with the external source.
   */
  private track?: RealtimeVideoTrack;

  /**
   * The callback reporting unexpected source termination.
   */
  private readonly onEnded = () => {
    this.onError(new XmaxError(
      XmaxErrorCode.mediaError,
      "External video source ended"
    ));
  };

  /**
   * Creates a controller with an external-track failure callback.
   */
  constructor(
    private readonly onError: (
      error: XmaxError
    ) => void
  ) { }

  /**
   * The external-video clone owned by the SDK.
   */
  get currentTrack(): RealtimeVideoTrack | undefined {
    return this.track;
  }

  /**
   * Validates and clones an external track, resolving its uplink baseline without modifying original
   * pixels.
   *
   * @param options - A live video track and its original media format.
   * @param mediaService - The model's media-sizing service.
   * @returns A local stream holding the cloned track and resolved fixed format.
   */
  create(
    options: {
      videoTrack: MediaStreamTrack;
      videoFormat: RealtimeVideoFormat
    },
    mediaService: MediaServicing
  ): RealtimeMediaStream {
    if (this.track) {
      throw new XmaxError(
        XmaxErrorCode.invalidConfiguration,
        "Close the current external video first"
      );
    }
    const { videoTrack, videoFormat } = options;
    if (
      !videoTrack || videoTrack.kind !== "video" ||
      videoTrack.readyState !== "live" || typeof videoTrack.clone !== "function"
    ) {
      throw new XmaxError(
        XmaxErrorCode.invalidConfiguration,
        "External video requires a live video MediaStreamTrack"
      );
    }
    const size = mediaService.resolveMediaSize(
      videoFormat,
      "external"
    );
    const format = videoFormat.resized(
      size.width,
      size.height
    );
    format.validate();
    const nativeTrack = videoTrack.clone();
    if (nativeTrack.readyState !== "live") {
      nativeTrack.stop();
      throw new XmaxError(
        XmaxErrorCode.mediaError,
        "External video source ended during setup"
      );
    }
    const track = new RealtimeVideoTrack({
      id: "external-video",
      videoFormat: format
    });
    track.mediaStreamTrack = nativeTrack;
    nativeTrack.addEventListener(
      "ended",
      this.onEnded
    );
    this.track = track;
    return new RealtimeMediaStream({
      id: StreamID.local,
      videoTrack: track
    });
  }

  /**
   * Removes termination observation and releases the SDK-owned clone.
   */
  stop(): void {
    const nativeTrack = this.track?.mediaStreamTrack;
    this.track = undefined;
    nativeTrack?.removeEventListener(
      "ended",
      this.onEnded
    );
    nativeTrack?.stop();
  }
}
