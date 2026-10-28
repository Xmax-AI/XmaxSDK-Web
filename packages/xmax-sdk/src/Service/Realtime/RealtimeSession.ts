//
//  RealtimeSession.ts
//  XmaxSDK
//
//  Author: 翁跃庭 (Yueting Weng)
//  GitHub: https://github.com/Xmax-AI/XmaxSDK-Web
//
//  Copyright (c) 2026 XMAX.AI PTE. LTD.
//

import type { RtcSessionConnection } from "./RealtimeSessionConnection";

/**
 * The identity, status, and RTC credentials for a realtime session.
 */
export interface RealtimeSessionInit {

  /**
   * The session ID returned as sessionUid.
   */
  id: string;

  /**
   * The business user ID.
   */
  userID?: string;

  /**
   * The session status, such as ACTIVE.
   */
  status?: string;

  /**
   * The RTC connection parameters.
   */
  connection?: RtcSessionConnection;

  /**
   * The session closure reason.
   */
  closeReason?: string;
}

/**
 * An Xmax realtime generation session.
 */
export class RealtimeSession {

  /**
   * The session ID returned as sessionUid.
   */
  readonly id: string;

  /**
   * The business user ID.
   */
  readonly userID?: string;

  /**
   * The session status, such as ACTIVE, when supplied by the response.
   */
  readonly status?: string;

  /**
   * The session closure reason.
   */
  readonly closeReason?: string;

  /**
   * The RTC connection parameters; omitted from responses without complete credentials.
   */
  readonly connection?: RtcSessionConnection;

  /**
   * Creates a realtime session.
   */
  constructor(
    init: RealtimeSessionInit
  ) {
    this.id = init.id;
    this.userID = init.userID;
    this.status = init.status;
    this.connection = init.connection;
    this.closeReason = init.closeReason;
  }
}
