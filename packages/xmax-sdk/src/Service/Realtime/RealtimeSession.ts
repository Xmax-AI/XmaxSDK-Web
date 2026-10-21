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
 * 实时会话身份、状态和连接凭据。
 */
export interface RealtimeSessionInit {

  /**
   * 会话标识（sessionUid）。
   */
  id: string;

  /**
   * 业务用户标识。
   */
  userID?: string;

  /**
   * 会话状态（如 ACTIVE）。
   */
  status?: string;

  /**
   * RTC 连接参数。
   */
  connection?: RtcSessionConnection;

  /**
   * 会话关闭原因。
   */
  closeReason?: string;
}

/**
 * Xmax 实时生成会话。
 */
export class RealtimeSession {

  /**
   * 会话标识（sessionUid）。
   */
  readonly id: string;

  /**
   * 业务用户标识。
   */
  readonly userID?: string;

  /**
   * 会话状态（如 ACTIVE）；响应未携带时为空。
   */
  readonly status?: string;

  /**
   * 会话关闭原因。
   */
  readonly closeReason?: string;

  /**
   * RTC 连接参数；心跳等响应未携带完整参数时为空。
   */
  readonly connection?: RtcSessionConnection;

  /**
   * 创建实时会话。
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
