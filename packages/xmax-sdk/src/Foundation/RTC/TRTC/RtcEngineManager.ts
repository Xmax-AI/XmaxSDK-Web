//
//  RtcEngineManager.ts
//  XmaxSDK
//
//  Author: 翁跃庭 (Yueting Weng)
//  GitHub: https://github.com/Xmax-AI/XmaxSDK-Web
//
//  Copyright (c) 2026 XMAX.AI PTE. LTD.
//

import type TRTC from "trtc-sdk-v5";
import { XmaxError, XmaxErrorCode } from "../../Errors/XmaxError";

/**
 * The TRTC engine instance type.
 */
export type RtcEngine = TRTC;

/**
 * An exclusive lease on a shared TRTC engine.
 */
export class RtcEngineLease {

  /**
   * The leased TRTC engine.
   */
  readonly engine: RtcEngine;

  /**
   * The lease ID.
   */
  readonly id: string;

  /**
   * Creates an exclusive lease identifying the engine for release validation.
   */
  constructor(
    engine: RtcEngine
  ) {
    this.engine = engine;
    this.id = `lease-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
  }
}

/**
 * A queued request for an exclusive engine lease.
 */
interface EngineRequest {

  /**
   * The unique lease-request ID.
   */
  id: string;

  /**
   * The callback delivering the acquired lease.
   */
  resolve: (
    lease: RtcEngineLease
  ) => void;

  /**
   * The callback rejecting the pending request.
   */
  reject: (
    error: unknown
  ) => void;
}

/**
 * Creates, leases, queues, and destroys shared TRTC engines exclusively.
 *
 * Engine creation does not require session credentials, so local preview can initialize it early. Lazy
 * importing defers TRTC browser access and permits SDK imports during SSR and tests.
 */
export class RtcEngineManager {

  /**
   * The shared engine manager.
   */
  static readonly shared = new RtcEngineManager();

  /**
   * The factory creating a TRTC engine.
   */
  private readonly makeEngine: () => Promise<RtcEngine>;

  /**
   * The currently held engine lease.
   */
  private activeLease?: RtcEngineLease;

  /**
   * The pending exclusive-lease requests.
   */
  private requests: EngineRequest[] = [];

  /**
   * Creates a TRTC engine manager.
   */
  constructor(
    makeEngine: () => Promise<RtcEngine> = RtcEngineManager.defaultMakeEngine,
  ) {
    this.makeEngine = makeEngine;
  }

  /**
   * Waits for an exclusive engine lease.
   *
   * @returns A lease that must be released after use.
   */
  async acquire(): Promise<RtcEngineLease> {
    if (!this.activeLease && this.requests.length === 0) {
      const lease = await this.createLease();
      this.activeLease = lease;
      return lease;
    }
    return new Promise<RtcEngineLease>((
      resolve,
      reject
    ) => {
      this.requests.push({
        id: `req-${Date.now()}-${this.requests.length}`,
        resolve,
        reject,
      });
    });
  }

  /**
   * Releases a valid lease, destroys its engine, and hands ownership to the next waiter.
   */
  release(
    lease: RtcEngineLease
  ): void {
    if (this.activeLease?.id !== lease.id) {
      return;
    }
    this.activeLease = undefined;
    try {
      lease.engine.destroy();
    } catch {
      // Engine destruction failure must not prevent lease release.
    }
    void this.fulfillNextRequest();
  }

  /**
   * Lazily loads TRTC and creates an engine.
   */
  private static async defaultMakeEngine(): Promise<RtcEngine> {
    const module = await import("trtc-sdk-v5");
    // Disable TRTC console output while retaining its default diagnostic upload behavior.
    // Set the level before creating an engine so native logs do not obscure SDK output.
    module.default.setLogLevel(5);
    return module.default.create();
  }

  /**
   * Creates a new engine lease.
   */
  private async createLease(): Promise<RtcEngineLease> {
    const engine = await this.makeEngine();
    if (!engine) {
      throw new XmaxError(
        XmaxErrorCode.rtcError,
        "Failed to create RTC Engine",
      );
    }
    return new RtcEngineLease(engine);
  }

  /**
   * Services queued requests, rejecting failed engine creation and continuing with subsequent waiters.
   */
  private async fulfillNextRequest(): Promise<void> {
    while (!this.activeLease && this.requests.length > 0) {
      const request = this.requests.shift();
      if (!request) {
        return;
      }
      try {
        const lease = await this.createLease();
        this.activeLease = lease;
        request.resolve(lease);
      } catch (error) {
        request.reject(error);
      }
    }
  }
}
