//
//  QualityHistory.ts
//  XmaxSDK
//
//  Author: 翁跃庭 (Yueting Weng)
//  GitHub: https://github.com/Xmax-AI/XmaxSDK-Web
//
//  Copyright (c) 2026 XMAX.AI PTE. LTD.
//

import { INITIAL_QUALITY_LEVEL, QUALITY_TIERS } from "./QualityTiers";
import type { RtcProvider } from "../../Foundation/RTC/RtcProvider";

/**
 * The transmission direction of quality history.
 */
type QualityDirection = "uplink" | "downlink";

/**
 * Successful levels retained for one hour, isolated by provider, model, and direction without storing
 * media or credentials.
 */
export class QualityHistory {

  /**
   * The history lifetime, in milliseconds.
   */
  private static readonly expirationMs = 60 * 60 * 1000;

  /**
   * Creates model- and provider-specific quality history.
   */
  constructor(
    private readonly model: string,
    private readonly provider: RtcProvider,
    private readonly now: () => number = Date.now,
  ) { }

  /**
   * Returns L2 for missing, expired, malformed, inaccessible, or clock-regressed history.
   */
  read(
    direction: QualityDirection
  ): number {
    try {
      const entry = JSON.parse(globalThis.localStorage.getItem(this.key(direction)) ?? "null");
      const now = this.now();
      if (entry && this.isValid(entry.level) && Number.isFinite(entry.savedAt) &&
        entry.savedAt > 0 && now >= entry.savedAt && now - entry.savedAt < QualityHistory.expirationMs) {
        return entry.level;
      }
    } catch { /**
     * Unavailable storage must not affect generation.
     */ }
    return INITIAL_QUALITY_LEVEL;
  }

  /**
   * Stores a successful level and refreshes its one-hour lifetime; downlink success means signaling
   * submission only.
   */
  write(
    direction: QualityDirection,
    level: number
  ): void {
    if (!this.isValid(level)) {
      return;
    }
    try {
      globalThis.localStorage.setItem(
        this.key(direction),
        JSON.stringify({
          level,
          savedAt: this.now()
        })
      );
    } catch { /**
     * Storage quota or permission errors must not interrupt adaptation.
     */ }
  }

  /**
   * Builds a direction-specific storage key; timestamp-free records are invalid.
   */
  private key(
    direction: QualityDirection
  ): string {
    return `xmax:quality:v1:${this.provider}:${encodeURIComponent(this.model)}:${direction}`;
  }

  /**
   * Validates a quality-level number.
   */
  private isValid(
    level: number
  ): boolean {
    return Number.isInteger(level) && level >= 1 && level <= Object.keys(QUALITY_TIERS).length;
  }
}
