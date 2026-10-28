//
//  RemoteStream.ts
//  XmaxSDK
//
//  Author: 翁跃庭 (Yueting Weng)
//  GitHub: https://github.com/Xmax-AI/XmaxSDK-Web
//
//  Copyright (c) 2026 XMAX.AI PTE. LTD.
//

/**
 * The identity of a remote video stream.
 */
export interface RemoteStreamInit {

  /**
   * The room containing the remote stream.
   */
  roomID: string;

  /**
   * The user publishing the remote stream.
   */
  userID: string;
}

/**
 * The identity of a remote main stream in an RTC room.
 */
export class RemoteStream {

  /**
   * The room containing the remote stream.
   */
  readonly roomID: string;

  /**
   * The user publishing the remote stream.
   */
  readonly userID: string;

  /**
   * Creates a remote-stream identity.
   */
  constructor(
    init: RemoteStreamInit
  ) {
    this.roomID = init.roomID;
    this.userID = init.userID;
  }

  /**
   * The stream key unique across rooms.
   */
  get key(): string {
    return `${this.roomID}:${this.userID}`;
  }
}
