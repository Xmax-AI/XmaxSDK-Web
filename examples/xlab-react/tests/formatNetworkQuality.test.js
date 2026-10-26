import { describe, expect, it } from "vitest";
import { formatNetworkQuality } from "../src/formatNetworkQuality";
import { RealtimeNetworkQualityLevel } from "@xmaxai/web-sdk";

describe("network quality labels", () => {
  it.each([
    [RealtimeNetworkQualityLevel.unknown, "未知"],
    [RealtimeNetworkQualityLevel.excellent, "极好"],
    [RealtimeNetworkQualityLevel.good, "良好"],
    [RealtimeNetworkQualityLevel.poor, "一般"],
    [RealtimeNetworkQualityLevel.bad, "差"],
    [RealtimeNetworkQualityLevel.veryBad, "极差"],
    [RealtimeNetworkQualityLevel.down, "断网"],
  ])(
    "maps network level %s to %s", (quality, label) => expect(formatNetworkQuality(quality)).toBe(label),
  );
  it("shows a placeholder for missing or invalid samples", () => {
    expect(formatNetworkQuality()).toBe("—");
    expect(formatNetworkQuality(7)).toBe("—");
  });
});
