//
//  RealtimeSessionService.ts
//  XmaxSDK
//
//  Author: 翁跃庭 (Yueting Weng)
//  GitHub: https://github.com/Xmax-AI/XmaxSDK-Web
//
//  Copyright (c) 2026 XMAX.AI PTE. LTD.
//

import { XmaxError, XmaxErrorCode } from "../../Foundation/Errors/XmaxError";
import type { RealtimeModelName } from "./RealtimeModel";
import { RtcProvider } from "../../Foundation/RTC/RtcProvider";
import type { ApiServicing } from "../Network/ApiServicing";
import { RealtimeSession } from "./RealtimeSession";
import { RealtimeSessionConnection, type RtcSessionConnection } from "./RealtimeSessionConnection";
import type {
  RealtimeSessionHeartbeatHandlers,
  RealtimeSessionServicing,
} from "./RealtimeSessionServicing";

/**
 * The shared session API payload.
 */
interface SessionPayload {

  /**
   * The server session ID.
   */
  sessionUid?: string;

  /**
   * The business user ID.
   */
  userUid?: string;

  /**
   * The server-reported session state.
   */
  status?: string;

  /**
   * RTC credentials interpreted using the configured provider.
   */
  modelExtra?: unknown;

  /**
   * The server's session closure reason.
   */
  closeReason?: string;
}

/**
 * RTC credentials from modelExtra, interpreted using the configured provider.
 */
interface ConnectionPayload {

  /**
   * The RTC room ID returned by the server.
   */
  room_id?: string;

  /**
   * The business user ID used for VeRTC sessions.
   */
  user_id?: string;

  /**
   * The VeRTC result-stream user ID.
   */
  bot_name?: string;

  /**
   * The RTC application ID.
   */
  rtc_app_id?: string;

  /**
   * The user ID used to join TRTC or Agora.
   */
  rtc_user_id?: string;

  /**
   * The TRTC user login signature.
   */
  user_sig?: string;

  /**
   * The TRTC credential authorizing access to a string-ID room.
   */
  private_map_key_with_string_room_id?: string;

  /**
   * The RTC user ID associated with generated results.
   */
  rtc_bot_id?: string;

  /**
   * The Agora or VeRTC room token.
   */
  room_token?: string;
}

/**
 * Session API, RTC provider, and heartbeat settings.
 */
export interface RealtimeSessionServiceOptions {

  /**
   * The Xmax API request service.
   */
  apiService: ApiServicing;

  /**
   * The configured RTC provider, not inferred from response fields or the model name.
   */
  provider?: RtcProvider;

  /**
   * The heartbeat interval, in milliseconds; defaults to 10000.
   */
  heartbeatIntervalMs?: number;

  /**
   * The replaceable heartbeat delay implementation.
   */
  sleep?: (
    ms: number
  ) => Promise<void>;
}

/**
 * Creates, maintains, and closes realtime sessions.
 *
 * Successful heartbeats deliver refreshed credentials through onRefresh. Revisions invalidate responses
 * from stopped heartbeat loops.
 */
export class RealtimeSessionService implements RealtimeSessionServicing {

  /**
   * The API service used for session requests.
   */
  private readonly apiService: ApiServicing;

  /**
   * The RTC provider determining join parameters and credential interpretation.
   */
  private readonly provider: RtcProvider;

  /**
   * The heartbeat interval, in milliseconds.
   */
  private readonly heartbeatIntervalMs: number;

  /**
   * The scheduler waiting for a duration in milliseconds.
   */
  private readonly sleep: (
    ms: number
  ) => Promise<void>;

  /**
   * The revision identifying the current heartbeat loop.
   */
  private heartbeatVersion = 0;

  /**
   * Per-session credentials supporting partial heartbeat updates, removed on closure.
   */
  private readonly credentials = new Map<string, ConnectionPayload>();

  /**
   * The in-progress credential refresh for each session ID.
   */
  private readonly refreshes = new Map<string, Promise<RealtimeSession>>();

  /**
   * Creates a realtime session service.
   */
  constructor(
    options: RealtimeSessionServiceOptions
  ) {
    this.apiService = options.apiService;
    this.provider = options.provider ?? RtcProvider.trtc;
    if (!Object.values(RtcProvider).includes(this.provider)) {
      throw new XmaxError(
        XmaxErrorCode.invalidConfiguration,
        "Unsupported RTC provider"
      );
    }
    this.heartbeatIntervalMs = options.heartbeatIntervalMs ?? 10_000;
    this.sleep =
      options.sleep ??
      ((ms) => new Promise<void>((resolve) => setTimeout(
        resolve,
        ms
      )));
  }

  /**
   * Creates a session and returns its RTC connection information.
   */
  async createSession(
    model: RealtimeModelName
  ): Promise<RealtimeSession> {
    const payload = await this.apiService.post<SessionPayload>(
      "/session",
      {
        model,
      }
    );
    try {
      const session = this.makeSession(
        payload,
        true
      );
      RealtimeSessionService.ensureSessionActive(session);
      const credentials = RealtimeSessionService.decodeConnectionPayload(payload.modelExtra)!;
      this.credentials.set(
        session.id,
        this.provider === RtcProvider.vertc
          ? {
            ...credentials,
            user_id: session.connection!.userID
          } : credentials
      );
      return session;
    } catch (error) {
      // Attempt to close a created session even when its credentials are invalid to avoid leaving a billable session.
      const sessionID = RealtimeSessionService.nonEmpty(payload.sessionUid);
      if (sessionID) {
        await this.closeSession(sessionID).catch(() => { });
      }
      throw error;
    }
  }

  /**
   * Starts periodic heartbeats for a session, replacing any existing heartbeat loop.
   */
  startHeartbeat(
    sessionID: string,
    handlers: RealtimeSessionHeartbeatHandlers,
  ): void {
    const version = ++this.heartbeatVersion;
    void this.runHeartbeat(
      version,
      sessionID,
      handlers
    );
  }

  /**
   * Stops heartbeats and suppresses obsolete pending responses.
   */
  stopHeartbeat(): void {
    this.heartbeatVersion += 1;
  }

  /**
   * Closes a realtime session with a keepalive request eligible to survive page unload.
   */
  async closeSession(
    sessionID: string
  ): Promise<void> {
    this.credentials.delete(sessionID);
    this.refreshes.delete(sessionID);
    try {
      await this.apiService.delete<Record<string, never>>(
        `/session/${sessionID}`,
        { keepalive: true },
      );
    } catch (error) {
      throw XmaxError.from(error);
    }
  }

  /**
   * Runs periodic heartbeats, delivering refreshed active sessions or reporting failure and invalidating
   * the loop.
   */
  private async runHeartbeat(
    version: number,
    sessionID: string,
    handlers: RealtimeSessionHeartbeatHandlers,
  ): Promise<void> {
    while (this.heartbeatVersion === version) {
      await this.sleep(this.heartbeatIntervalMs);
      if (this.heartbeatVersion !== version) {
        return;
      }
      try {
        const session = await this.heartbeatSession(sessionID);
        if (this.heartbeatVersion !== version) {
          return;
        }
        RealtimeSessionService.ensureSessionActive(session);
        await handlers.onRefresh?.(session);
      } catch (error) {
        if (this.heartbeatVersion !== version) {
          return;
        }
        this.heartbeatVersion += 1;
        await handlers.onFailure(
          sessionID,
          XmaxError.from(error)
        );
        return;
      }
    }
  }

  /**
   * Requests a single heartbeat without requiring complete connection parameters.
   */
  heartbeatSession(
    sessionID: string
  ): Promise<RealtimeSession> {
    const pending = this.refreshes.get(sessionID);
    if (pending) {
      return pending;
    }
    const operation = this.performHeartbeat(sessionID);
    this.refreshes.set(
      sessionID,
      operation
    );
    void operation.finally(() => {
      if (this.refreshes.get(sessionID) === operation) {
        this.refreshes.delete(sessionID);
      }
    }).catch(() => { });
    return operation;
  }

  /**
   * Merges partial heartbeat credentials without recreating cache entries for closed sessions.
   */
  private async performHeartbeat(
    sessionID: string
  ): Promise<RealtimeSession> {
    const previous = this.credentials.get(sessionID);
    const payload = await this.apiService.put<SessionPayload>(
      `/session/${sessionID}/heartbeat`,
    );
    const incoming = RealtimeSessionService.decodeConnectionPayload(payload.modelExtra);
    if (payload.modelExtra != null && !incoming) {
      throw new XmaxError(
        XmaxErrorCode.sessionError,
        "Invalid heartbeat RTC credentials"
      );
    }
    const merged = incoming ? {
      ...previous,
      ...incoming
    } : previous;
    const session = this.makeSession(
      {
        ...payload,
        modelExtra: merged
      },
      merged !== undefined
    );
    if (session.id !== sessionID) {
      throw new XmaxError(
        XmaxErrorCode.sessionError,
        "Heartbeat session identity changed"
      );
    }
    RealtimeSessionService.ensureSessionActive(session);
    if (previous && this.credentials.get(sessionID) === previous && merged) {
      this.credentials.set(
        sessionID,
        merged
      );
    }
    return session;
  }

  /**
   * Rejects sessions explicitly reported as non-ACTIVE.
   */
  private static ensureSessionActive(
    session: RealtimeSession
  ): void {
    if (!session.status || session.status === "ACTIVE") {
      return;
    }
    throw new XmaxError(
      XmaxErrorCode.sessionError,
      session.closeReason ?? `Session is no longer active: ${session.status}`,
    );
  }

  /**
   * Creates a session model, requiring complete credentials when requiresConnection is true.
   */
  private makeSession(
    payload: SessionPayload,
    requiresConnection: boolean,
  ): RealtimeSession {
    const sessionID = RealtimeSessionService.nonEmpty(payload.sessionUid);
    if (!sessionID) {
      throw new XmaxError(
        XmaxErrorCode.sessionError,
        "Invalid session response"
      );
    }

    const connection = this.makeConnection(
      payload.modelExtra,
      payload.userUid
    );
    if (requiresConnection && !connection) {
      throw new XmaxError(
        XmaxErrorCode.sessionError,
        "Session does not contain complete RTC join information",
      );
    }

    return new RealtimeSession({
      id: sessionID,
      userID: RealtimeSessionService.nonEmpty(payload.userUid),
      status: RealtimeSessionService.nonEmpty(payload.status),
      connection,
      closeReason: RealtimeSessionService.nonEmpty(payload.closeReason),
    });
  }

  /**
   * Parses modelExtra credentials, returning undefined for incomplete or unsupported connection data.
   */
  private makeConnection(
    modelExtra: unknown,
    fallbackUserID?: string,
  ): RtcSessionConnection | undefined {
    const payload = RealtimeSessionService.decodeConnectionPayload(modelExtra);
    if (!payload) {
      return undefined;
    }

    const provider = this.provider;

    const roomID = RealtimeSessionService.nonEmpty(payload.room_id);
    const sdkAppID = RealtimeSessionService.nonEmpty(payload.rtc_app_id);
    const userID = provider === RtcProvider.vertc
      ? RealtimeSessionService.nonEmpty(payload.user_id) ?? RealtimeSessionService.nonEmpty(fallbackUserID)
      : RealtimeSessionService.nonEmpty(payload.rtc_user_id);
    if (!roomID || !sdkAppID || !userID) {
      return undefined;
    }
    if (provider === RtcProvider.agora || provider === RtcProvider.vertc) {
      const roomToken = RealtimeSessionService.nonEmpty(payload.room_token);
      if (!roomToken) {
        return undefined;
      }
      return Object.freeze({
        provider,
        roomID,
        appID: sdkAppID,
        userID,
        roomToken,
        botID: RealtimeSessionService.nonEmpty(provider === RtcProvider.vertc ? payload.bot_name : payload.rtc_bot_id)
      });
    }
    const userSig = RealtimeSessionService.nonEmpty(payload.user_sig);
    const privateMapKey = RealtimeSessionService.nonEmpty(
      payload.private_map_key_with_string_room_id,
    );
    if (!roomID || !sdkAppID || !userID || !userSig || !privateMapKey) {
      return undefined;
    }

    return new RealtimeSessionConnection({
      provider: RtcProvider.trtc,
      roomID,
      sdkAppID,
      userID,
      userSig,
      privateMapKey,
      botID: RealtimeSessionService.nonEmpty(payload.rtc_bot_id),
    });
  }

  /**
   * Decodes connection fields from an object or JSON string.
   */
  private static decodeConnectionPayload(
    modelExtra: unknown,
  ): ConnectionPayload | undefined {
    if (typeof modelExtra === "string") {
      try {
        return RealtimeSessionService.decodeConnectionPayload(JSON.parse(modelExtra));
      } catch {
        return undefined;
      }
    }
    if (typeof modelExtra === "object" && modelExtra !== null && !Array.isArray(modelExtra)) {
      return modelExtra as ConnectionPayload;
    }
    return undefined;
  }

  /**
   * Trims an optional string and returns undefined when empty.
   */
  private static nonEmpty(
    value?: string
  ): string | undefined {
    const normalized = typeof value === "string" ? value.trim() : undefined;
    return normalized || undefined;
  }
}
