//
//  RealtimeVideoTrack.ts
//  XmaxSDK
//
//  Author: 翁跃庭 (Yueting Weng)
//  GitHub: https://github.com/Xmax-AI/XmaxSDK-Web
//
//  Copyright (c) 2026 XMAX.AI PTE. LTD.
//

import { CameraPosition } from "../../Foundation/Media/Camera/CameraPosition";
import { RealtimeVideoFormat } from "./RealtimeVideoFormat";

/**
 * A video track's identity and initial media metadata.
 */
export interface RealtimeVideoTrackInit {

  /**
   * The video track ID.
   */
  id: string;

  /**
   * The track's current video format.
   */
  videoFormat?: RealtimeVideoFormat;

  /**
   * The camera position for a local camera track.
   */
  position?: CameraPosition;
}

/**
 * A realtime video track with mutable media metadata.
 *
 * The internal MediaStreamTrack handle binds its media to an HTML video element.
 */
export class RealtimeVideoTrack {

  /**
   * The video track ID.
   */
  readonly id: string;

  /**
   * The current video format and camera position.
   */
  private metadata: {
    videoFormat?: RealtimeVideoFormat;
    position?: CameraPosition;
  };

  /**
   * The underlying browser media track used internally by XmaxSDK. Available after local capture starts
   * or remote subscription succeeds.
   */
  mediaStreamTrack?: MediaStreamTrack;

  /**
   * Creates a realtime video track.
   */
  constructor(
    init: RealtimeVideoTrackInit
  ) {
    this.id = init.id;
    this.metadata = {
      videoFormat: init.videoFormat,
      position: init.position,
    };
  }

  /**
   * The video format currently associated with the track.
   */
  get videoFormat(): RealtimeVideoFormat | undefined {
    return this.metadata.videoFormat;
  }

  /**
   * The camera position currently associated with a local camera track.
   */
  get position(): CameraPosition | undefined {
    return this.metadata.position;
  }

  /**
   * Updates the track's video format.
   *
   * @internal
   */
  updateVideoFormat(
    videoFormat: RealtimeVideoFormat
  ): void {
    this.metadata.videoFormat = videoFormat;
  }

  /**
   * Updates the track's camera position.
   *
   * @internal
   */
  updatePosition(
    position: CameraPosition
  ): void {
    this.metadata.position = position;
  }
}
