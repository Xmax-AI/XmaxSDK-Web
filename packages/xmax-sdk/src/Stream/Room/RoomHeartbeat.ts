//
//  RoomHeartbeat.ts
//  XmaxSDK
//
//  Author: 翁跃庭 (Yueting Weng)
//  GitHub: https://github.com/Xmax-AI/XmaxSDK-Web
//
//  Copyright (c) 2026 XMAX.AI PTE. LTD.
//

import { XmaxError } from "../../Foundation/Errors/XmaxError";
import { XmaxLogger } from "../../Foundation/Logging/XmaxLogger";
import type { RtcManaging } from "../../Foundation/RTC/RtcManaging";
import { RoomEvent } from "./RoomEvent";

/**
 * Dependencies and scheduling options for room heartbeats.
 */
export interface RoomHeartbeatOptions {

  /**
   * The RTC engine used to send messages.
   */
  rtcManager: RtcManaging;

  /**
   * The heartbeat interval, in milliseconds; defaults to 10000.
   */
  intervalMs?: number;

  /**
   * An optional replacement for the heartbeat delay.
   */
  sleep?: (
    ms: number
  ) => Promise<void>;
}

/**
 * Sends periodic room heartbeats and invalidates stopped cycles using a revision.
 */
export class RoomHeartbeat {

  /**
   * The RTC engine used for heartbeat delivery.
   */
  private readonly rtcManager: RtcManaging;

  /**
   * The delay between heartbeats, in milliseconds.
   */
  private readonly intervalMs: number;

  /**
   * The scheduler that resolves after a delay in milliseconds.
   */
  private readonly sleep: (
    ms: number
  ) => Promise<void>;

  /**
   * The revision used to invalidate previous heartbeat cycles.
   */
  private cycleVersion = 0;

  /**
   * Creates a room heartbeat scheduler.
   */
  constructor(
    options: RoomHeartbeatOptions
  ) {
    this.rtcManager = options.rtcManager;
    this.intervalMs = options.intervalMs ?? 10_000;
    this.sleep =
      options.sleep ??
      ((ms) => new Promise<void>((resolve) => setTimeout(
        resolve,
        ms
      )));
  }

  /**
   * Starts a heartbeat cycle, replacing any existing cycle.
   */
  start(
    userID: string
  ): void {
    const version = ++this.cycleVersion;
    void this.run(
      version,
      userID
    );
  }

  /**
   * Stops the current cycle and prevents delayed sends from that cycle.
   */
  stop(): void {
    this.cycleVersion += 1;
  }

  /**
   * Waits and sends heartbeats repeatedly; logs send failures and continues the cycle.
   */
  private async run(
    version: number,
    userID: string
  ): Promise<void> {
    while (this.cycleVersion === version) {
      await this.sleep(this.intervalMs);
      if (this.cycleVersion !== version) {
        return;
      }
      try {
        await this.rtcManager.sendRoomMessage(RoomEvent.heartbeat({ userID }));
      } catch (error) {
        if (this.cycleVersion !== version) {
          return;
        }
        XmaxLogger.room.error(
          () =>
            `发送 RTC 房间心跳失败 (Failed to Send RTC Room Heartbeat)\n` +
            `└─ ${XmaxLogger.localized("原因：", "Reason: ")}${XmaxError.from(error).message}`,
        );
      }
    }
  }
}
