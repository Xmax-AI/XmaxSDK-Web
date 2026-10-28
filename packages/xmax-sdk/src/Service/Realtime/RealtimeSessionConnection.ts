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
import {
  RoomJoinConfiguration,
  type RtcRoomJoinConfiguration,
  type VeRtcRoomJoinConfiguration
} from "../../Foundation/RTC/RoomJoinConfiguration";

/**
 * The room identity and authentication credentials for a TRTC session.
 */
export interface RealtimeSessionConnectionInit {

  /**
   * The discriminator for TRTC credentials.
   */
  provider: RtcProvider.trtc;

  /**
   * The string TRTC room ID.
   */
  roomID: string;

  /**
   * The TRTC SDKAppID represented as a string.
   */
  sdkAppID: string;

  /**
   * The TRTC login identity from rtc_user_id, not the business user_id.
   */
  userID: string;

  /**
   * The TRTC login signature.
   */
  userSig: string;

  /**
   * The TRTC privateMapKey used to authorize entry into a string-ID room.
   */
  privateMapKey: string;

  /**
   * The generation bot's user ID, used to match the remote result stream.
   */
  botID?: string;
}

/**
 * TRTC connection credentials for a realtime session.
 *
 * Credentials come from data.modelExtra; the configured provider selects their interpretation.
 * Successful heartbeats may supply updated userSig and privateMapKey values that replace cached
 * credentials.
 */
export class RealtimeSessionConnection {

  /**
   * The discriminator for TRTC credentials.
   */
  readonly provider: RtcProvider.trtc;

  /**
   * The string TRTC room ID.
   */
  readonly roomID: string;

  /**
   * The TRTC SDKAppID represented as a string.
   */
  readonly sdkAppID: string;

  /**
   * The TRTC login identity from rtc_user_id, not the business user_id.
   */
  readonly userID: string;

  /**
   * The TRTC login signature.
   */
  readonly userSig: string;

  /**
   * The TRTC privateMapKey used to authorize entry into a string-ID room.
   */
  readonly privateMapKey: string;

  /**
   * The generation bot's user ID, used to match the remote result stream.
   */
  readonly botID?: string;

  /**
   * Creates RTC connection credentials.
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
 * Receives a realtime session heartbeat failure.
 */
export type RealtimeSessionHeartbeatFailureHandler = (
  sessionID: string,
  error: XmaxError,
) => void | Promise<void>;

/**
 * Receives the refreshed session after a successful heartbeat while the session remains active.
 */
export type RealtimeSessionHeartbeatRefreshHandler = (
  session: RealtimeSession,
) => void | Promise<void>;

/**
 * Agora credentials whose channel and UID are used unchanged for joining and room signaling.
 */
export interface AgoraSessionConnection {

  /**
   * The discriminator for Agora credentials.
   */
  readonly provider: RtcProvider.agora;

  /**
   * The RTC room ID.
   */
  readonly roomID: string;

  /**
   * The RTC application ID.
   */
  readonly appID: string;

  /**
   * The RTC user ID.
   */
  readonly userID: string;

  /**
   * The room user ID associated with the generation result stream.
   */
  readonly botID?: string;

  /**
   * The token for joining the RTC room and renewing credentials. It must not be logged.
   */
  readonly roomToken: string;
}

/**
 * VeRTC connection credentials for a realtime session.
 */
export interface VeRtcSessionConnection extends VeRtcRoomJoinConfiguration {

  /**
   * The room user ID associated with the generation result stream.
   */
  readonly botID?: string;
}

/**
 * Session credentials discriminated by RTC provider.
 */
export type RtcSessionConnection = RealtimeSessionConnection | AgoraSessionConnection | VeRtcSessionConnection;

/**
 * Converts session credentials to room-join parameters using the configured provider discriminator.
 */
export function toRoomJoinConfiguration(
  connection: RtcSessionConnection
): RtcRoomJoinConfiguration {
  return connection.provider === RtcProvider.trtc ? new RoomJoinConfiguration(connection) : connection;
}

/**
 * Returns the application ID from provider-specific credentials.
 */
export function connectionAppID(
  connection: RtcSessionConnection
): string {
  return connection.provider === RtcProvider.trtc ? connection.sdkAppID : connection.appID;
}
