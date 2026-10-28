//
//  RealtimeMediaStream.ts
//  XmaxSDK
//
//  Author: 翁跃庭 (Yueting Weng)
//  GitHub: https://github.com/Xmax-AI/XmaxSDK-Web
//
//  Copyright (c) 2026 XMAX.AI PTE. LTD.
//

import { RealtimeVideoTrack } from "./RealtimeVideoTrack";

/**
 * A media stream used as realtime generation input or output.
 */
export class RealtimeMediaStream {

  /**
   * The media stream ID.
   */
  readonly id: string;

  /**
   * The stream's video track.
   */
  readonly videoTrack?: RealtimeVideoTrack;

  /**
   * Creates a realtime media stream.
   */
  constructor(
    init: {
      id: string;
      videoTrack?: RealtimeVideoTrack
    }
  ) {
    this.id = init.id;
    this.videoTrack = init.videoTrack;
  }
}
