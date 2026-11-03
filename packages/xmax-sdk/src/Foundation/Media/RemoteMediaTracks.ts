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
 * Shared result video and original audio borrowed without transferring SDK track ownership.
 */
export interface RemoteMediaTracks {

  /**
   * The task binding ID separating tasks that reuse the same RTC tracks.
   */
  readonly bindingID: string;

  /**
   * The RTC user publishing the result stream.
   */
  readonly userID: string;

  /**
   * The shared result video track, including enabled beauty. Effect switches retain this track;
   * dimensions may follow RTC quality changes.
   */
  readonly videoTrack: MediaStreamTrack;

  /**
   * The remote audio track before playback volume processing; absent until audio is published.
   */
  readonly audioTrack?: MediaStreamTrack;
}
