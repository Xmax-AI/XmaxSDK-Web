//
//  RecordingTracks.ts
//  XmaxSDK
//
//  Author: 翁跃庭 (Yueting Weng)
//  GitHub: https://github.com/Xmax-AI/XmaxSDK-Web
//
//  Copyright (c) 2026 XMAX.AI PTE. LTD.
//

/**
 * 同一远端媒体源的原始轨道；借用句柄，不转移所有权。
 */
export interface RecordingTracks {

  /**
   * 必需的视频轨。
   */
  videoTrack: MediaStreamTrack;

  /**
   * 可晚于视频就绪的音频轨。
   */
  audioTrack?: MediaStreamTrack;
}
