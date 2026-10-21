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
 * 实时生成输入/输出的媒体流。
 */
export class RealtimeMediaStream {

  /**
   * 媒体流标识。
   */
  readonly id: string;

  /**
   * 媒体流包含的视频轨道。
   */
  readonly videoTrack?: RealtimeVideoTrack;

  /**
   * 创建实时媒体流。
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
