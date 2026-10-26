import { describe, expect, it } from "vitest";
import { RealtimeConfiguration } from "../src/Core/Realtime/RealtimeConfiguration";
import { RealtimeModel } from "../src/Service/Realtime/RealtimeModel";
import { RtcProvider } from "../src/Foundation/RTC/RtcProvider";

describe("RealtimeConfiguration", () => {
  it.each([
    [RealtimeModel.x2_0, RtcProvider.vertc],
    [RealtimeModel.x2_1, RtcProvider.agora],
  ] as const)("keeps the public configuration minimal for %s", (model, provider) => {
    expect(new RealtimeConfiguration({ model })).toEqual({
      model, provider, isFrameInterpolationEnabled: false, isAdaptiveQualityEnabled: true,
    });
  });

  it("allows automatic quality adaptation to be disabled", () => {
    expect(new RealtimeConfiguration({
      model: RealtimeModel.x2_1,
      isAdaptiveQualityEnabled: false,
    }).isAdaptiveQualityEnabled).toBe(false);
  });
});
