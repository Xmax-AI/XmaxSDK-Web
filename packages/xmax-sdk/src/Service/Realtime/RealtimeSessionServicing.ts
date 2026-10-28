//
//  RealtimeSessionServicing.ts
//  XmaxSDK
//
//  Author: 翁跃庭 (Yueting Weng)
//  GitHub: https://github.com/Xmax-AI/XmaxSDK-Web
//
//  Copyright (c) 2026 XMAX.AI PTE. LTD.
//

import type { RealtimeModelName } from "./RealtimeModel";
import type {
  RealtimeSessionHeartbeatFailureHandler,
  RealtimeSessionHeartbeatRefreshHandler,
} from "./RealtimeSessionConnection";
import type { RealtimeSession } from "./RealtimeSession";

/**
 * Callbacks for the realtime session heartbeat lifecycle.
 */
export interface RealtimeSessionHeartbeatHandlers {

  /**
   * Reports one heartbeat failure or invalid session, then stops the heartbeat.
   */
  onFailure: RealtimeSessionHeartbeatFailureHandler;

  /**
   * Receives refreshed session data, including updated RTC credentials, after a successful heartbeat.
   */
  onRefresh?: RealtimeSessionHeartbeatRefreshHandler;
}

/**
 * The realtime session API and heartbeat lifecycle capabilities.
 */
export interface RealtimeSessionServicing {

  /**
   * Creates a realtime session with RTC connection information.
   *
   * @param model - The realtime generation model.
   * @returns A session containing RTC connection parameters.
   * @throws Rejects if the request fails or complete RTC credentials are missing.
   */
  createSession(
    model: RealtimeModelName
  ): Promise<RealtimeSession>;

  /**
   * Requests one heartbeat and returns current credentials for RTC token renewal.
   */
  heartbeatSession(
    sessionID: string
  ): Promise<RealtimeSession>;

  /**
   * Starts periodic heartbeats, replacing any existing heartbeat.
   *
   * @param sessionID - The session ID.
   * @param handlers - The failure and credential-refresh callbacks.
   */
  startHeartbeat(
    sessionID: string,
    handlers: RealtimeSessionHeartbeatHandlers,
  ): void;

  /**
   * Stops heartbeats and prevents obsolete pending responses from invoking callbacks.
   */
  stopHeartbeat(): void;

  /**
   * Closes a realtime session.
   *
   * @param sessionID - The session ID.
   */
  closeSession(
    sessionID: string
  ): Promise<void>;
}
