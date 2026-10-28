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
 * The TRTC room identity and authentication settings.
 */
export interface RoomJoinConfigurationInit {

  /**
   * The string TRTC room ID.
   */
  roomID: string;

  /**
   * The TRTC login identity from rtc_user_id.
   */
  userID: string;

  /**
   * The SDKAppID as a string, converted to a number when joining.
   */
  sdkAppID: string;

  /**
   * The TRTC login signature.
   */
  userSig: string;

  /**
   * The TRTC privateMapKey authorizing entry into a string-ID room.
   */
  privateMapKey: string;
}

/**
 * The TRTC room-join configuration.
 */
export class RoomJoinConfiguration {

  /**
   * The RTC provider.
   */
  readonly provider = RtcProvider.trtc;

  /**
   * The string TRTC room ID.
   */
  readonly roomID: string;

  /**
   * The TRTC login identity from rtc_user_id.
   */
  readonly userID: string;

  /**
   * The SDKAppID as a string, converted to a number when joining.
   */
  readonly sdkAppID: string;

  /**
   * The TRTC login signature.
   */
  readonly userSig: string;

  /**
   * The TRTC privateMapKey authorizing entry into a string-ID room.
   */
  readonly privateMapKey: string;

  /**
   * Creates room-join parameters.
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
 * Agora join parameters whose application, channel, user, and token must belong to the same session.
 */
export interface AgoraRoomJoinConfiguration {

  /**
   * The RTC credential discriminator.
   */
  readonly provider: RtcProvider.agora;

  /**
   * The RTC room ID.
   */
  readonly roomID: string;

  /**
   * The RTC user ID.
   */
  readonly userID: string;

  /**
   * The RTC application ID.
   */
  readonly appID: string;

  /**
   * The authentication token used for joining and renewal.
   */
  readonly roomToken: string;
}

/**
 * VeRTC join parameters, kept separate from other providers' credentials.
 */
export interface VeRtcRoomJoinConfiguration {

  /**
   * The RTC credential discriminator.
   */
  readonly provider: RtcProvider.vertc;

  /**
   * The RTC room ID.
   */
  readonly roomID: string;

  /**
   * The RTC user ID.
   */
  readonly userID: string;

  /**
   * The RTC application ID.
   */
  readonly appID: string;

  /**
   * The authentication token used for joining and renewal.
   */
  readonly roomToken: string;
}

/**
 * Room-join parameters discriminated by RTC provider.
 */
export type RtcRoomJoinConfiguration = RoomJoinConfiguration | AgoraRoomJoinConfiguration | VeRtcRoomJoinConfiguration;
