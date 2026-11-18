//
//  QualityController.ts
//  XmaxSDK
//
//  Author: 翁跃庭 (Yueting Weng)
//  GitHub: https://github.com/Xmax-AI/XmaxSDK-Web
//
//  Copyright (c) 2026 XMAX.AI PTE. LTD.
//

import { QUALITY_TIERS } from "./QualityTiers";
import { DEFAULT_POLICY, type QualityPolicy } from "./QualityPolicy";
import { RealtimeNetworkQualityLevel } from "../../Service/Realtime/RealtimeNetworkQuality";

/**
 * The ordered L1–L5 presets used for adjacent transitions.
 */
const ORDERED_QUALITY_TIERS = Object.values(QUALITY_TIERS);

/**
 * A network-triggered quality-level transition and its cause.
 */
export interface QualityChange {

  /**
   * The previous level, from 1 to 5; frame rate alone does not identify a preset.
   */
  from: number;

  /**
   * The resulting level, from 1 to 5.
   */
  to: number;

  /**
   * The scale relative to the fixed media baseline; the caller resolves dimensions.
   */
  scale: number;

  /**
   * The uplink frame-rate limit for the selected level, in fps.
   */
  frameRate: number;

  /**
   * The reason for downgrading, probing an upgrade, or reverting a failed probe.
   */
  reason: "poorNetwork" | "probeUpgrade" | "failedProbe";
}

/**
 * A per-direction quality state machine, initially stopped and independent of RTC and timers.
 *
 * Start after generation succeeds, pass only newly received quality samples, and stop on reconnection,
 * replacement, or termination. Applied changes must honor cancellation and operation leases. Downlink
 * levels describe submitted targets without server acknowledgments.
 */
export class QualityController {

  /**
   * The sample thresholds and transition windows.
   */
  private readonly policy: QualityPolicy;

  /**
   * Whether this state machine is active.
   */
  private active = false;

  /**
   * The current index in the ordered quality presets.
   */
  private index = 0;

  /**
   * The consecutive good-network sample count.
   */
  private good = 0;

  /**
   * The consecutive poor-network sample count.
   */
  private poor = 0;

  /**
   * The monotonic time of the last valid sample, in milliseconds.
   */
  private lastSampleAt?: number;

  /**
   * The earliest monotonic time for resuming sample accumulation after a transition, in milliseconds.
   */
  private stableUntil = 0;

  /**
   * The earliest monotonic time for another upgrade probe, in milliseconds.
   */
  private upgradeAfter = 0;

  /**
   * The active upgrade-probe deadline, in monotonic milliseconds.
   */
  private probeUntil = 0;

  /**
   * Whether a quality change is being applied.
   */
  private switching = false;

  /**
   * The controller invalidating work from an obsolete lifecycle.
   */
  private lifecycle = new AbortController();

  /**
   * Creates a quality state machine that retains its level when the adjacent candidate violates encoding
   * limits.
   */
  constructor(
    private readonly apply: (
      change: QualityChange,
      signal: AbortSignal
    ) => Promise<void>,
    private readonly now: () => number = () => performance.now(),
    policy: Partial<QualityPolicy> = {},
    private readonly canApply: (
      level: number
    ) => boolean = () => true,
  ) {
    this.policy = {
      ...DEFAULT_POLICY,
      ...policy
    };
    for (const value of Object.values(this.policy)) {
      if (!Number.isFinite(value) || value < 0) {
        throw new Error("Invalid quality policy");
      }
    }
    for (const value of [this.policy.poorSamples, this.policy.goodSamples]) {
      if (!Number.isInteger(value) || value < 1) {
        throw new Error("Sample counts must be positive integers");
      }
    }
  }

  /**
   * An immutable snapshot of the current level, activity, and upgrade waiting state.
   */
  get snapshot() {
    return Object.freeze({
      active: this.active,
      level: this.index + 1,
      ...ORDERED_QUALITY_TIERS[this.index]!,
      switching: this.switching,
      upgradeAfter: this.upgradeAfter,
    });
  }

  /**
   * Starts from a caller-supplied level without changing encoding settings.
   */
  start(
    level = 1
  ): void {
    if (!Number.isInteger(level) || level < 1 || level > ORDERED_QUALITY_TIERS.length) {
      throw new Error("Unsupported quality level");
    }
    this.stop();
    this.lifecycle = new AbortController();
    this.index = level - 1;
    this.active = true;
    this.stableUntil = this.upgradeAfter = this.probeUntil = 0;
  }

  /**
   * Invalidates old-session results while retaining serialization until pending native work completes.
   */
  stop(): void {
    this.active = false;
    this.lifecycle.abort();
    this.resetSamples();
  }

  /**
   * Discards accumulated samples during foreground work while retaining failed-probe cooldown.
   */
  resetSamples(): void {
    this.resetCounts();
    this.lastSampleAt = undefined;
  }

  /**
   * Processes only new quality events, never timer-replayed cached statistics. The caller reports
   * failures.
   */
  async observe(
    quality: RealtimeNetworkQualityLevel | undefined,
    sampleAt = this.now()
  ): Promise<QualityChange | undefined> {
    if (!this.active || this.switching || !Number.isFinite(sampleAt)) {
      return;
    }
    const now = this.now();
    if (sampleAt > now) {
      return;
    }
    if (this.lastSampleAt !== undefined) {
      if (sampleAt <= this.lastSampleAt) {
        return;
      }
      if (sampleAt - this.lastSampleAt > this.policy.sampleTimeoutMs) {
        this.resetCounts();
      }
    }
    this.lastSampleAt = sampleAt;
    if (now - sampleAt > this.policy.sampleTimeoutMs || sampleAt < this.stableUntil) {
      this.resetCounts();
      return;
    }
    if (quality === RealtimeNetworkQualityLevel.bad || quality === RealtimeNetworkQualityLevel.veryBad) {
      this.good = 0;
      this.poor++;
      if (this.poor >= this.policy.poorSamples && this.index < ORDERED_QUALITY_TIERS.length - 1) {
        return this.change(
          this.index + 1,
          now < this.probeUntil ? "failedProbe" : "poorNetwork"
        );
      }
    } else if (quality === RealtimeNetworkQualityLevel.excellent || quality === RealtimeNetworkQualityLevel.good) {
      this.poor = 0;
      if (sampleAt < this.upgradeAfter) {
        this.good = 0;
        return;
      }
      this.good++;
      if (this.good >= this.policy.goodSamples && this.index > 0) {
        return this.change(
          this.index - 1,
          "probeUpgrade"
        );
      }
    } else {
      // Unknown, intermediate, disconnected, and invalid ratings break consecutive counts without inferring bandwidth.
      this.resetCounts();
    }
    return;
  }

  /**
   * Clears consecutive good and poor sample counts.
   */
  private resetCounts(): void {
    this.good = this.poor = 0;
  }

  /**
   * Applies an adjacent candidate and updates state and transition windows after success.
   */
  private async change(
    index: number,
    reason: QualityChange["reason"]
  ): Promise<QualityChange | undefined> {
    this.resetCounts();
    if (!this.canApply(index + 1)) {
      return;
    }

    const lifecycle = this.lifecycle;
    const change: QualityChange = {
      from: this.index + 1,
      to: index + 1,
      ...ORDERED_QUALITY_TIERS[index]!,
      reason
    };
    this.switching = true;
    try {
      await this.apply(
        change,
        lifecycle.signal
      );
      if (lifecycle.signal.aborted) {
        return;
      }
      this.index = index;
      const now = this.now();
      this.stableUntil = now + this.policy.stabilizationMs;
      this.probeUntil = reason === "probeUpgrade" ? now + this.policy.probeMs : 0;
      if (reason === "failedProbe") {
        this.upgradeAfter = now + this.policy.upgradeCooldownMs;
      }
      return change;
    } catch (error) {
      if (!lifecycle.signal.aborted) {
        this.stableUntil = this.now() + this.policy.stabilizationMs;
        throw error;
      }
      return;
    } finally {
      this.switching = false;
    }
  }
}
