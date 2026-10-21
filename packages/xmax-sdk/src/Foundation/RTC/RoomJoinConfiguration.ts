//
//  RoomJoinConfiguration.ts
//  XmaxSDK
//
//  Author: 翁跃庭 (Yueting Weng)
//  GitHub: https://github.com/Xmax-AI/XmaxSDK-Web
//
//  Copyright (c) 2026 XMAX.AI PTE. LTD.
//

import { RtcProvider } from "./RtcProvider";

/**
 * TRTC 进房身份和鉴权参数。
 */
export interface RoomJoinConfigurationInit {

  /**
   * TRTC 房间号（字符串房间号）。
   */
  roomID: string;

  /**
   * TRTC 登录身份（`rtc_user_id`）。
   */
  userID: string;

  /**
   * TRTC SDKAppID（字符串形式，进房时转换为数值）。
   */
  sdkAppID: string;

  /**
   * TRTC 登录签名。
   */
  userSig: string;

  /**
   * TRTC 进房鉴权字段（字符串房间号对应的 privateMapKey）。
   */
  privateMapKey: string;
}

/**
 * RTC 房间加入参数。
 */
export class RoomJoinConfiguration {

  /**
   * RTC 提供方。
   */
  readonly provider = RtcProvider.trtc;

  /**
   * TRTC 房间号（字符串房间号）。
   */
  readonly roomID: string;

  /**
   * TRTC 登录身份（`rtc_user_id`）。
   */
  readonly userID: string;

  /**
   * TRTC SDKAppID（字符串形式，进房时转换为数值）。
   */
  readonly sdkAppID: string;

  /**
   * TRTC 登录签名。
   */
  readonly userSig: string;

  /**
   * TRTC 进房鉴权字段（字符串房间号对应的 privateMapKey）。
   */
  readonly privateMapKey: string;

  /**
   * 创建房间加入参数。
   */
  constructor(
    init: RoomJoinConfigurationInit
  ) {
    this.roomID = init.roomID;
    this.userID = init.userID;
    this.sdkAppID = init.sdkAppID;
    this.userSig = init.userSig;
    this.privateMapKey = init.privateMapKey;
  }
}

/**
 * 声网进房参数；App ID、频道、用户和 Token 必须来自同一会话。
 */
export interface AgoraRoomJoinConfiguration {

  /**
   * RTC 提供方，决定进房参数和凭据的解析方式。
   */
  readonly provider: RtcProvider.agora;

  /**
   * RTC 房间标识。
   */
  readonly roomID: string;

  /**
   * RTC 用户标识。
   */
  readonly userID: string;

  /**
   * RTC 应用标识。
   */
  readonly appID: string;

  /**
   * 进房及续期使用的鉴权令牌。
   */
  readonly roomToken: string;
}

/**
 * 火山引擎进房参数，不混用不同厂商的鉴权字段。
 */
export interface VeRtcRoomJoinConfiguration {

  /**
   * RTC 提供方，决定进房参数和凭据的解析方式。
   */
  readonly provider: RtcProvider.vertc;

  /**
   * RTC 房间标识。
   */
  readonly roomID: string;

  /**
   * RTC 用户标识。
   */
  readonly userID: string;

  /**
   * RTC 应用标识。
   */
  readonly appID: string;

  /**
   * 进房及续期使用的鉴权令牌。
   */
  readonly roomToken: string;
}

/**
 * 按 RTC 提供方区分的进房参数。
 */
export type RtcRoomJoinConfiguration = RoomJoinConfiguration | AgoraRoomJoinConfiguration | VeRtcRoomJoinConfiguration;
