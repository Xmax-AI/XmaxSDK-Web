import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { XmaxLogger, XmaxLoggerOption } from "../src/Foundation/Logging/XmaxLogger";
import { RtcStatsLogger } from "../src/Foundation/RTC/RtcStatsLogger";
import { XmaxEnvironment } from "../src/Foundation/Runtime/XmaxEnvironment";
import { RealtimeNetworkQualityLevel } from "../src/Foundation/RTC/NetworkStatistics";
import type { DownlinkVideoStatistics, UplinkVideoStatistics } from "../src/Foundation/RTC/VideoStatistics";

describe("RtcStatsLogger", () => {
  beforeEach(() => {
    vi.spyOn(console, "info").mockImplementation(() => {});
    XmaxLogger.configure(XmaxLoggerOption.performance);
  });

  afterEach(() => {
    XmaxLogger.configure(XmaxLoggerOption.none);
    vi.restoreAllMocks();
  });

  it("matches the iOS uplink field order, labels, units and tree layout", () => {
    const stats: UplinkVideoStatistics = {
      width: 1024, height: 1920, captureFrameRate: 30,
      encodeFrameRate: 27, sendFrameRate: 24, bitrateKbps: 6293, packetLossPercent: 2,
    };
    const expected = [
      "视频上行统计 (Video Uplink Statistics)",
      "├─ 分辨率：1024 × 1920",
      "├─ 发送码率：6293 kbps",
      "├─ 采集帧率：30 fps",
      "├─ 编码帧率：27 fps",
      "├─ 发送帧率：24 fps",
      "└─ 视频丢包率：2 %",
    ].join("\n");
    expect(RtcStatsLogger.uplinkVideoStatisticsMessage(stats)).toBe(expected);
    RtcStatsLogger.logUplinkVideoStatistics(stats);
    expect(console.info).toHaveBeenCalledWith(`[Xmax][RTC] ${expected}`);
  });

  it("matches the iOS English downlink layout and treats a partial resolution as unavailable", () => {
    XmaxLogger.configure(XmaxLoggerOption.performance, XmaxEnvironment.global);
    const stats: DownlinkVideoStatistics = {
      userID: "private-bot", width: 1920, decodeFrameRate: 26,
      renderFrameRate: 0, bitrateKbps: 0, packetLossPercent: 0,
    };
    const expected = [
      "视频下行统计 (Video Downlink Statistics)",
      "├─ Resolution: —",
      "├─ Receive Bitrate: 0 kbps",
      "├─ Decode Frame Rate: 26 fps",
      "├─ Render Frame Rate: 0 fps",
      "├─ Video Packet Loss: 0 %",
      "└─ End-to-End Delay: —",
    ].join("\n");
    expect(RtcStatsLogger.downlinkVideoStatisticsMessage(stats)).toBe(expected);
    RtcStatsLogger.logDownlinkVideoStatistics(stats);
    expect(console.info).toHaveBeenCalledWith(`[Xmax][RTC] ${expected}`);
    expect(expected).not.toContain("private-bot");
  });

  it("keeps six unavailable placeholders per direction and does not infer missing frame stages", () => {
    const up = RtcStatsLogger.uplinkVideoStatisticsMessage({});
    const down = RtcStatsLogger.downlinkVideoStatisticsMessage({ userID: "bot" });
    expect(up.match(/—/g)).toHaveLength(6);
    expect(down.match(/—/g)).toHaveLength(6);
    const sending = RtcStatsLogger.uplinkVideoStatisticsMessage({ sendFrameRate: 30 });
    expect(sending).toContain("编码帧率：—");
    expect(sending).toContain("发送帧率：30 fps");
  });

  it("retains zero metrics and limits fractional Web measurements to two decimal places", () => {
    const message = RtcStatsLogger.uplinkVideoStatisticsMessage({
      width: 1024, height: 1920, captureFrameRate: 29.456,
      encodeFrameRate: 0, sendFrameRate: 0, bitrateKbps: 0, packetLossPercent: 0,
    });
    expect(message).toContain("采集帧率：29.46 fps");
    expect(message).toContain("编码帧率：0 fps");
    expect(message).toContain("发送帧率：0 fps");
    expect(message).toContain("发送码率：0 kbps");
    expect(message).toContain("视频丢包率：0 %");
    expect(message).not.toContain("—");
  });

  it.each([undefined, -1, NaN, Infinity])("renders missing or invalid values without exposing them (%s)", value => {
    const up = RtcStatsLogger.uplinkVideoStatisticsMessage({
      width: value, height: 1920, bitrateKbps: value,
      captureFrameRate: value, encodeFrameRate: value, sendFrameRate: value, packetLossPercent: value,
    });
    expect(up.match(/—/g)).toHaveLength(6);
    expect(up).not.toMatch(/NaN|Infinity|undefined|-1/);
  });

  it("retains connection diagnostics separately and never serializes extra fields", () => {
    const stats = Object.assign({
      rttMs: 32.126, uplinkLossPercent: 1.25, downlinkLossPercent: 0, sentBytes: 1000, receivedBytes: 2000,
    }, { token: "must-not-log", authorization: "secret" });
    RtcStatsLogger.logConnectionStatistics(stats);
    const message = vi.mocked(console.info).mock.calls[0]![0] as string;
    expect(message).toContain("RTT: 32.13 ms");
    expect(message).toContain("上行丢包率：1.25 %");
    expect(message).toContain("下行丢包率：0 %");
    expect(message).toContain("累计发送：1000 bytes");
    expect(message).not.toMatch(/must-not-log|secret|Video Uplink/);
    const down = RtcStatsLogger.downlinkVideoStatisticsMessage(Object.assign({ userID: "private-bot", endToEndDelayMs: 85 }, stats));
    expect(down).toContain("端到端时延：85 ms");
    expect(down).not.toMatch(/RTT|must-not-log|secret|private-bot/);
  });

  it("uses English details for the global environment and logs network quality separately", () => {
    XmaxLogger.configure(XmaxLoggerOption.all, XmaxEnvironment.global);
    RtcStatsLogger.logNetworkQuality({
      uplink: RealtimeNetworkQualityLevel.excellent, downlink: RealtimeNetworkQualityLevel.down,
      uplinkRTT: 10, downlinkRTT: 0, uplinkLoss: 2.5, downlinkLoss: 0,
    });
    expect(console.info).toHaveBeenCalledWith(expect.stringContaining("Local Uplink: Excellent, RTT 10 ms, Loss 2.5 %"));
    expect(console.info).toHaveBeenCalledWith(expect.stringContaining("Local Downlink (Average): Disconnected, RTT 0 ms, Loss 0 %"));
  });

  it("does not fabricate directional RTT or packet loss from a quality rating", () => {
    RtcStatsLogger.logNetworkQuality({ uplink: RealtimeNetworkQualityLevel.good, downlink: RealtimeNetworkQualityLevel.poor });
    const message = vi.mocked(console.info).mock.calls[0]![0] as string;
    expect(message).toContain("本地上行：良好");
    expect(message).toContain("本地下行（平均）：一般");
    expect(message).not.toMatch(/RTT|丢包率/);
  });

  it.each([XmaxLoggerOption.none, XmaxLoggerOption.business])("does not format or emit disabled performance logs (%s)", (option) => {
    XmaxLogger.configure(option);
    const unreadable = { get width(): number { throw new Error("must not format"); } };
    const connection = { get rttMs(): number { throw new Error("must not format"); } };
    const quality = { get uplink(): RealtimeNetworkQualityLevel { throw new Error("must not format"); }, downlink: RealtimeNetworkQualityLevel.unknown };
    expect(() => RtcStatsLogger.logUplinkVideoStatistics(unreadable)).not.toThrow();
    expect(() => RtcStatsLogger.logDownlinkVideoStatistics(unreadable as DownlinkVideoStatistics)).not.toThrow();
    expect(() => RtcStatsLogger.logConnectionStatistics(connection)).not.toThrow();
    expect(() => RtcStatsLogger.logNetworkQuality(quality)).not.toThrow();
    expect(console.info).not.toHaveBeenCalled();
  });
});
