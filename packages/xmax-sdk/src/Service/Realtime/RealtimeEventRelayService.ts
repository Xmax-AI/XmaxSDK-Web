//
//  RealtimeEventRelayService.ts
//  XmaxSDK
//
//  Author: 翁跃庭 (Yueting Weng)
//  GitHub: https://github.com/Xmax-AI/XmaxSDK-Web
//
//  Copyright (c) 2026 XMAX.AI PTE. LTD.
//

import { XmaxError, XmaxErrorCode } from "../../Foundation/Errors/XmaxError";
import { XmaxLogger } from "../../Foundation/Logging/XmaxLogger";
import { ApiMethod, type ApiServicing } from "../Network/ApiServicing";

/**
 * Submits generation controls to the HTTP relay without retrying or waiting for model acknowledgement.
 */
export class RealtimeEventRelayService {

  /**
   * Creates a relay service using the environment's authenticated relay endpoint.
   */
  constructor(
    private readonly apiService: ApiServicing
  ) { }

  /**
   * Submits one complete command. Both accepted and previously accepted responses are successful.
   * Cancellation stops local work without withdrawing an event already accepted by the platform.
   */
  async relay(
    options: {
      sessionID: string;
      modelID: string;
      data: Record<string, unknown>;
      signal: AbortSignal;
    }
  ): Promise<void> {
    const startedAt = performance.now();
    const response = await this.apiService.request<unknown>(
      ApiMethod.post,
      "/client-event/relay",
      {
        sessionId: options.sessionID,
        modelId: options.modelID,
        data: options.data,
      },
      { signal: options.signal },
    );
    if (!response || typeof response !== "object" || Array.isArray(response) ||
      !("xid" in response) || response.xid !== options.data.xid ||
      !("accepted" in response) || typeof response.accepted !== "boolean") {
      throw new XmaxError(
        XmaxErrorCode.apiError,
        "Server returned invalid event relay response",
      );
    }

    if (!options.signal.aborted) {
      XmaxLogger.room.info(() =>
        `HTTP 信令转发 (HTTP Signaling Relay)\n` +
        `├─ event: ${options.data.event}, xid: ${options.data.xid}\n` +
        `├─ sessionID: ${options.sessionID}, modelID: ${options.modelID}\n` +
        `└─ accepted: ${response.accepted}, elapsed: ${(performance.now() - startedAt).toFixed(1)} ms`);
    }
  }
}
