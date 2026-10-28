//
//  QualityPolicy.ts
//  XmaxSDK
//
//  Author: 翁跃庭 (Yueting Weng)
//  GitHub: https://github.com/Xmax-AI/XmaxSDK-Web
//
//  Copyright (c) 2026 XMAX.AI PTE. LTD.
//

/**
 * Adaptation sample thresholds and timing windows; sample counts are positive integers and durations are
 * in milliseconds.
 */
export interface QualityPolicy {

  /**
   * The consecutive bad/veryBad samples required to downgrade; defaults to 3.
   */
  poorSamples: number;

  /**
   * The consecutive excellent/good samples required to probe an upgrade; defaults to 5.
   */
  goodSamples: number;

  /**
   * The pause after successful changes or failed applications, without sample accumulation; defaults to
   * 4000 ms.
   */
  stabilizationMs: number;

  /**
   * The post-upgrade probe window; a downgrade within it marks probe failure. Defaults to 20000 ms.
   */
  probeMs: number;

  /**
   * The upgrade lockout after successful failed-probe rollback; downgrades remain allowed. Defaults to
   * 60000 ms.
   */
  upgradeCooldownMs: number;

  /**
   * The maximum sample age and gap between consecutive samples; defaults to 5000 ms.
   */
  sampleTimeoutMs: number;
}

/**
 * The default fast-downgrade, slow-upgrade policy, with per-controller overrides.
 */
export const DEFAULT_POLICY: QualityPolicy = {
  poorSamples: 3,
  goodSamples: 5,
  stabilizationMs: 4000,
  probeMs: 20000,
  upgradeCooldownMs: 60000,
  sampleTimeoutMs: 5000,
};
