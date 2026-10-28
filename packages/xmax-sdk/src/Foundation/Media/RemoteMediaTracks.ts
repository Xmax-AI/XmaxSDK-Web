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
 * Original result-stream tracks borrowed without transferring RTC track ownership.
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
   * The subscribed original remote video track.
   */
  readonly videoTrack: MediaStreamTrack;

  /**
   * The remote audio track before playback volume processing; absent until audio is published.
   */
  readonly audioTrack?: MediaStreamTrack;
}
