import { afterEach, describe, expect, it, vi } from "vitest";
import type { IAgoraRTCClient } from "agora-rtc-sdk-ng";
import type { LocalVideoStats, RemoteVideoStats } from "@volcengine/rtc";
import { AgoraRtcStatistics } from "../src/Foundation/RTC/Agora/AgoraRtcStatistics";
import { VeRtcStatistics } from "../src/Foundation/RTC/VeRTC/VeRtcStatistics";
import { networkQualityLevel, RealtimeNetworkQualityLevel } from "../src/Foundation/RTC/NetworkStatistics";
import { XmaxLogger, XmaxLoggerOption } from "../src/Foundation/Logging/XmaxLogger";
import { RtcStatsLogger } from "../src/Foundation/RTC/RtcStatsLogger";

describe("RTC network quality conversion", () => {
  it.each([
    [0, RealtimeNetworkQualityLevel.unknown],
    [1, RealtimeNetworkQualityLevel.excellent],
    [2, RealtimeNetworkQualityLevel.good],
    [3, RealtimeNetworkQualityLevel.poor],
    [4, RealtimeNetworkQualityLevel.bad],
    [5, RealtimeNetworkQualityLevel.veryBad],
    [6, RealtimeNetworkQualityLevel.down],
  ])("maps vendor level %s to %s", (value, expected) => {
    expect(networkQualityLevel(value as number)).toBe(expected);
  });

  it.each([undefined, -1, 7, 1.5, NaN, Infinity, -Infinity])("treats invalid level %s as unknown", value => {
    expect(networkQualityLevel(value)).toBe(RealtimeNetworkQualityLevel.unknown);
  });
});

describe("RTC video statistics stages", () => {
  afterEach(() => {
    XmaxLogger.configure(XmaxLoggerOption.none);
    vi.restoreAllMocks();
  });

  it("logs the same normalized Agora objects as the callbacks without serializing native statistics", () => {
    XmaxLogger.configure(XmaxLoggerOption.performance);
    const info = vi.spyOn(console, "info").mockImplementation(() => {});
    const uplinkLog = vi.spyOn(RtcStatsLogger, "logUplinkVideoStatistics");
    const downlinkLog = vi.spyOn(RtcStatsLogger, "logDownlinkVideoStatistics");
    const nativeExtras = { token: "must-not-log", toJSON() { throw new Error("must not serialize native objects"); } };
    const client = {
      localTracks: [{ trackMediaType: "video" }],
      getRTCStats: () => ({ RTT: 32, SendBytes: 100, RecvBytes: 200 }),
      getLocalVideoStats: () => ({ ...nativeExtras, sendResolutionWidth: 1024, sendResolutionHeight: 1920, captureFrameRate: 30, sendFrameRate: 24, sendBitrate: 4200000, currentPacketLossRate: 0.02 }),
      getRemoteVideoStats: () => ({ "private-bot": { ...nativeExtras, receiveResolutionWidth: 1920, receiveResolutionHeight: 1024, decodeFrameRate: 24, renderFrameRate: 23, receiveBitrate: 4000000, currentPacketLossRate: 0, end2EndDelay: 85 } }),
    } as unknown as IAgoraRTCClient;
    const local = vi.fn(), remote = vi.fn();
    AgoraRtcStatistics.collect(client, {
      onLocalVideoStatistics: local, onRemoteVideoStatistics: remote,
      onRemoteVideoPublished: () => {}, onCustomMessageReceived: () => {},
    });
    expect(uplinkLog.mock.calls[0]![0]).toBe(local.mock.calls[0]![0]);
    expect(downlinkLog.mock.calls[0]![0]).toBe(remote.mock.calls[0]![0][0]);
    const text = info.mock.calls.flat().join("\n");
    expect(text).toContain("发送码率：4200 kbps");
    expect(text).toContain("编码帧率：—");
    expect(text).toContain("视频丢包率：2 %");
    expect(text).toContain("接收码率：4000 kbps");
    expect(text).toContain("端到端时延：85 ms");
    expect(text).not.toMatch(/must-not-log|private-bot|sendResolutionWidth|Agora RTC Statistics/);
    expect(info).toHaveBeenCalledTimes(3);
  });

  it.each([0, undefined, -1, NaN, Infinity])("keeps actual Agora frame stages and filters unavailable values (%s)", fps => {
    XmaxLogger.configure(XmaxLoggerOption.none);
    const client = {
      localTracks: [{ trackMediaType: "video" }],
      getRTCStats: () => ({}),
      getLocalVideoStats: () => ({ captureFrameRate: fps, sendFrameRate: fps, currentPacketLossRate: 0 }),
      getRemoteVideoStats: () => ({ bot: { receiveFrameRate: 99, decodeFrameRate: fps, renderFrameRate: fps, currentPacketLossRate: 0 } }),
    } as unknown as IAgoraRTCClient;
    const local = vi.fn();
    const remote = vi.fn();
    AgoraRtcStatistics.collect(client, {
      onLocalVideoStatistics: local,
      onRemoteVideoStatistics: remote,
      onRemoteVideoPublished: () => {},
      onCustomMessageReceived: () => {},
    });
    const expected = fps === 0 ? 0 : undefined;
    expect(local).toHaveBeenCalledWith({
      width: undefined, height: undefined, captureFrameRate: expected, sendFrameRate: expected,
      bitrateKbps: undefined, packetLossPercent: 0,
    });
    expect(local.mock.calls[0]![0].encodeFrameRate).toBeUndefined();
    expect(remote).toHaveBeenCalledWith([{
      userID: "bot", width: undefined, height: undefined, decodeFrameRate: expected, renderFrameRate: expected,
      bitrateKbps: undefined, packetLossPercent: 0, endToEndDelayMs: undefined,
    }]);
  });

  it.each([0, 1, -1, 1.1, NaN, Infinity, undefined])("validates VeRTC packet loss and missing frame stages (%s)", loss => {
    const uplink = VeRtcStatistics.local({ videoLossRate: loss } as LocalVideoStats);
    const downlink = VeRtcStatistics.remote("bot", { videoLossRate: loss } as RemoteVideoStats);
    const expected = loss === 0 ? 0 : loss === 1 ? 100 : undefined;
    expect(uplink.packetLossPercent).toBe(expected);
    expect(downlink.packetLossPercent).toBe(expected);
    expect(uplink.captureFrameRate).toBeUndefined();
    expect(uplink.encodeFrameRate).toBeUndefined();
    expect(uplink.sendFrameRate).toBeUndefined();
    expect(downlink.decodeFrameRate).toBeUndefined();
    expect(downlink.renderFrameRate).toBeUndefined();
    expect(Object.isFrozen(uplink)).toBe(true);
    expect(Object.isFrozen(downlink)).toBe(true);
  });
});
