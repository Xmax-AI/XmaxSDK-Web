//
//  RemoteMediaTracks.ts
//  XmaxSDK
//
//  Author: 翁跃庭 (Yueting Weng)
//  GitHub: https://github.com/Xmax-AI/XmaxSDK-Web
//
//  Copyright (c) 2026 XMAX.AI PTE. LTD.
//

/**
 * 当前结果流的原始媒体轨，仅借用，不转移 RTC 轨道所有权。
 */
export interface RemoteMediaTracks {

  /**
   * 生成任务的绑定标识，用于隔离同一 RTC 轨上的不同任务。
   */
  readonly bindingID: string;

  /**
   * 实际结果流的 RTC 用户。
   */
  readonly userID: string;

  /**
   * 订阅到的远端原始视频轨。
   */
  readonly videoTrack: MediaStreamTrack;

  /**
   * 播放音量处理前的远端音轨；音频尚未发布或没有音轨时为空。
   */
  readonly audioTrack?: MediaStreamTrack;
}
