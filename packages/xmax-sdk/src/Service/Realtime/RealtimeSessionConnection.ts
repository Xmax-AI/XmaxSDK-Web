//
//  RealtimeSessionConnection.ts
//  XmaxSDK
//
//  Author: 翁跃庭 (Yueting Weng)
//  GitHub: https://github.com/Xmax-AI/XmaxSDK-Web
//
//  Copyright (c) 2026 XMAX.AI PTE. LTD.
//

import { RtcProvider } from "../../Foundation/RTC/RtcProvider";
import type { XmaxError } from "../../Foundation/Errors/XmaxError";
import type { RealtimeSession } from "./RealtimeSession";
import { RoomJoinConfiguration, type RtcRoomJoinConfiguration, type VeRtcRoomJoinConfiguration } from "../../Foundation/RTC/RoomJoinConfiguration";

/**
 * TRTC 会话对应的房间身份和鉴权凭据。
 */
export interface RealtimeSessionConnectionInit {

  /**
   * TRTC 凭据的提供方判别字段。
   */
  provider: RtcProvider.trtc;

  /**
   * TRTC 房间号（字符串房间号）。
   */
  roomID: string;

  /**
   * TRTC SDKAppID（按字符串处理）。
   */
  sdkAppID: string;

  /**
   * TRTC 登录身份（`rtc_user_id`，不是业务 `user_id`）。
   */
  userID: string;

  /**
   * TRTC 登录签名。
   */
  userSig: string;

  /**
   * TRTC 进房鉴权字段（字符串房间号对应的 privateMapKey）。
   */
  privateMapKey: string;

  /**
   * 房间内生成 Bot 的用户标识，用于匹配远端结果流。
   */
  botID?: string;
}

/**
 * 实时会话对应的 RTC 连接参数（TRTC）。
 *
 * 凭据来自会话接口 `data.modelExtra`，provider 由接入配置决定；心跳成功后服务端可能
 * 下发新的 `userSig` / `privateMapKey`，使用方应覆盖本地缓存。
 */
export class RealtimeSessionConnection {

  /**
   * TRTC 凭据的提供方判别字段。
   */
  readonly provider: RtcProvider.trtc;

  /**
   * TRTC 房间号（字符串房间号）。
   */
  readonly roomID: string;

  /**
   * TRTC SDKAppID（按字符串处理）。
   */
  readonly sdkAppID: string;

  /**
   * TRTC 登录身份（`rtc_user_id`，不是业务 `user_id`）。
   */
  readonly userID: string;

  /**
   * TRTC 登录签名。
   */
  readonly userSig: string;

  /**
   * TRTC 进房鉴权字段（字符串房间号对应的 privateMapKey）。
   */
  readonly privateMapKey: string;

  /**
   * 房间内生成 Bot 的用户标识，用于匹配远端结果流。
   */
  readonly botID?: string;

  /**
   * 创建 RTC 连接参数。
   */
  constructor(
    init: RealtimeSessionConnectionInit
  ) {
    this.provider = init.provider;
    this.roomID = init.roomID;
    this.sdkAppID = init.sdkAppID;
    this.userID = init.userID;
    this.userSig = init.userSig;
    this.privateMapKey = init.privateMapKey;
    this.botID = init.botID;
  }
}

/**
 * 实时会话心跳失败回调。
 */
export type RealtimeSessionHeartbeatFailureHandler = (
  sessionID: string,
  error: XmaxError,
) => void | Promise<void>;

/**
 * 实时会话心跳刷新回调；心跳成功且会话仍活跃时携带最新会话数据。
 */
export type RealtimeSessionHeartbeatRefreshHandler = (
  session: RealtimeSession,
) => void | Promise<void>;

/**
 * 声网会话凭证；频道与 UID 原样用于 RTC 入房和房间信令。
 */
export interface AgoraSessionConnection {

  /**
   * 提供方与房间身份
   */
  readonly provider: RtcProvider.agora;

  /**
   * RTC 房间标识。
   */
  readonly roomID: string;

  /**
   * RTC 应用标识。
   */
  readonly appID: string;

  /**
   * RTC 用户标识。
   */
  readonly userID: string;

  /**
   * 生成结果流对应的房间用户标识。
   */
  readonly botID?: string;

  /**
   * RTC 入房与续期凭证，不写入日志。
   */
  readonly roomToken: string;
}

/**
 * RTC 会话连接参数，按 provider 区分厂商凭证。
 */
export interface VeRtcSessionConnection extends VeRtcRoomJoinConfiguration {

  /**
   * 生成结果流对应的房间用户标识。
   */
  readonly botID?: string;
}

/**
 * 按 RTC 提供方区分的会话连接凭据。
 */
export type RtcSessionConnection = RealtimeSessionConnection | AgoraSessionConnection | VeRtcSessionConnection;

/**
 * provider 由接入配置赋值，只在 SDK 内部区分凭据类型。
 */
export function toRoomJoinConfiguration(
  connection: RtcSessionConnection
): RtcRoomJoinConfiguration {
  return connection.provider === RtcProvider.trtc ? new RoomJoinConfiguration(connection) : connection;
}

/**
 * 从对应 RTC 类型的会话凭据中读取应用标识。
 */
export function connectionAppID(
  connection: RtcSessionConnection
): string {
  return connection.provider === RtcProvider.trtc ? connection.sdkAppID : connection.appID;
}
