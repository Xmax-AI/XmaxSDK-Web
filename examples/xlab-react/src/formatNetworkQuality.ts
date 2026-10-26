import { RealtimeNetworkQualityLevel } from "@xmaxai/web-sdk";

const LABELS: Record<RealtimeNetworkQualityLevel, string> = {
  [RealtimeNetworkQualityLevel.unknown]: "未知",
  [RealtimeNetworkQualityLevel.excellent]: "极好",
  [RealtimeNetworkQualityLevel.good]: "良好",
  [RealtimeNetworkQualityLevel.poor]: "一般",
  [RealtimeNetworkQualityLevel.bad]: "差",
  [RealtimeNetworkQualityLevel.veryBad]: "极差",
  [RealtimeNetworkQualityLevel.down]: "断网",
};

export function formatNetworkQuality(quality?: RealtimeNetworkQualityLevel): string {
  return quality === undefined ? "—" : LABELS[quality] ?? "—";
}
