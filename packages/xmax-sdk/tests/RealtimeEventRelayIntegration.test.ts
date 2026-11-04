import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { XmaxClient } from "../src/Core/XmaxClient";
import { XmaxConfiguration } from "../src/Core/XmaxConfiguration";
import { XmaxEnvironment } from "../src/Core/XmaxEnvironment";
import { RealtimeConfiguration } from "../src/Core/Realtime/RealtimeConfiguration";
import { XmaxRealtimeFactory } from "../src/Core/Realtime/XmaxRealtimeFactory";
import { createRtcManager } from "../src/Foundation/RTC/RtcFactory";
import type { RtcEventListener } from "../src/Foundation/RTC/RtcEventListener";
import type { RtcManaging } from "../src/Foundation/RTC/RtcManaging";
import { RtcProvider } from "../src/Foundation/RTC/RtcProvider";
import { XmaxLogger, XmaxLoggerOption } from "../src/Foundation/Logging/XmaxLogger";
import { RealtimeContext } from "../src/Service/Realtime/RealtimeContext";
import { RealtimeVideoFormat } from "../src/Service/Realtime/RealtimeVideoFormat";
import { RealtimeVideoTrack } from "../src/Service/Realtime/RealtimeVideoTrack";

vi.mock("../src/Foundation/RTC/RtcFactory", () => ({ createRtcManager: vi.fn() }));

function setup(environment: XmaxEnvironment, provider = RtcProvider.agora) {
  let events: RtcEventListener | undefined;
  const rtc = {
    isInitialized: true,
    supportsRemoteAudioVolumeControl: true,
    setEventListener: vi.fn((listener?: RtcEventListener) => { events = listener; }),
    configureVideoEncoding: vi.fn(async () => {}),
    updateCredentials: vi.fn(async () => {}),
    joinRoom: vi.fn(async () => {}),
    leaveRoom: vi.fn(async () => {}),
    publishLocalVideo: vi.fn(async () => {}),
    unpublishLocalVideo: vi.fn(async () => {}),
    sendRoomMessage: vi.fn(async (_message: string) => {}),
    setRemoteAudioVolume: vi.fn(),
  };
  vi.mocked(createRtcManager).mockReturnValue(rtc as unknown as RtcManaging);
  const payload: {
    sessionUid: string;
    modelUid?: string;
    status: string;
    modelExtra: Record<string, string>;
  } = {
    sessionUid: "session-1", modelUid: "model-instance-1", status: "ACTIVE",
    modelExtra: {
      room_id: "room-1", rtc_app_id: "app-1", rtc_user_id: "user-1", user_id: "user-1",
      rtc_bot_id: "bot-1", bot_name: "bot-1", room_token: "token-1",
      user_sig: "sig-1", private_map_key_with_string_room_id: "key-1",
    },
  };
  const fetch = vi.fn(async (url: string, init: RequestInit) => {
    const data = url.endsWith("/client-event/relay")
      ? { xid: JSON.parse(init.body as string).data.xid, accepted: true }
      : payload;
    return new Response(JSON.stringify({ success: true, code: 200, data }));
  });
  vi.stubGlobal("fetch", fetch);
  const factory = vi.spyOn(XmaxRealtimeFactory, "make");
  const client = new XmaxClient(new XmaxConfiguration({ environment, apiKey: " relay-test-key " }));
  client.createRealtimeManager(new RealtimeConfiguration({ model: "custom-model", provider }));
  const components = factory.mock.results.at(-1)!.value as ReturnType<typeof XmaxRealtimeFactory.make>;
  const format = new RealtimeVideoFormat({ width: 1920, height: 1080, fps: 30 });
  const connect = () => components.connectionManager.connect({
    localTrack: new RealtimeVideoTrack({ id: "local", videoFormat: format }),
    model: "custom-model", includeLocalAudio: false, ensureCurrent: () => {}, onPublished: () => {},
  });
  const change = (prompt = "a cat") => components.streamController.updateGeneration({
    taskID: "task-1", videoFormat: format, context: new RealtimeContext({ prompt }),
  });
  const relays = () => fetch.mock.calls.filter(([url]) => url.endsWith("/client-event/relay"));
  return { components, rtc, fetch, connect, change, relays, payload, events: () => events };
}

beforeEach(() => vi.useFakeTimers());
afterEach(() => {
  XmaxLogger.configure(XmaxLoggerOption.none);
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
  vi.clearAllTimers();
  vi.useRealTimers();
});

describe("HTTP event relay assembly", () => {
  it.each([
    [XmaxEnvironment.china, RtcProvider.agora],
    [XmaxEnvironment.china, RtcProvider.trtc],
    [XmaxEnvironment.china, RtcProvider.vertc],
    [XmaxEnvironment.global, RtcProvider.agora],
    [XmaxEnvironment.global, RtcProvider.trtc],
    [XmaxEnvironment.global, RtcProvider.vertc],
  ] as const)("uses both RTC and the %s HTTP endpoint for %s controls with the assigned instance", async (environment, provider) => {
    const s = setup(environment, provider);
    const origin = environment === XmaxEnvironment.china ? "https://cloud.xmax.22duck.cn" : "https://api.xmax.ai";
    try {
      expect(s.fetch).not.toHaveBeenCalled();
      await s.connect();
      await s.change();
      expect(s.fetch.mock.calls[0]![0]).toBe(`${origin}/open/api/v1/session`);
      expect(s.relays()).toHaveLength(1);
      const [url, request] = s.relays()[0]!;
      expect(url).toBe(`${origin}/open/api/v1/client-event/relay`);
      expect(request.headers).toMatchObject({ "X-Api-Key": "relay-test-key" });
      const body = JSON.parse(request.body as string);
      expect(body).toMatchObject({ sessionId: "session-1", modelId: "model-instance-1", data: { event: "change_condition" } });
      expect(body.data).toMatchObject({ uid: "task-1", params: { prompt: "a cat", size: [1920, 1080] } });
      await vi.advanceTimersByTimeAsync(6000);
      expect(s.relays()).toHaveLength(1);
      const rtcControls = s.rtc.sendRoomMessage.mock.calls.map(([message]) => JSON.parse(message))
        .filter(message => ["start", "change_condition", "change_target_size"].includes(message.event));
      expect(rtcControls).toHaveLength(6);
      expect(rtcControls.every(message => JSON.stringify(message) === JSON.stringify(body.data))).toBe(true);
    } finally {
      await s.components.connectionManager.disconnect();
    }
  });

  it("warns and keeps RTC controls working when an older session response has no modelUid", async () => {
    const s = setup(XmaxEnvironment.china);
    s.payload.modelUid = undefined;
    const warning = vi.spyOn(console, "warn").mockImplementation(() => {});
    XmaxLogger.configure(XmaxLoggerOption.business);
    try {
      await s.connect();
      await s.change();
      expect(s.relays()).toHaveLength(0);
      expect(warning.mock.calls.flat().join(" ")).toContain("HTTP Signaling Relay Skipped");
      expect(s.rtc.sendRoomMessage.mock.calls.some(([message]) => JSON.parse(message).event === "change_condition")).toBe(true);
    } finally {
      await s.components.connectionManager.disconnect();
    }
  });

  it("preserves modelUid through a partial heartbeat and captures the new session on reconnection", async () => {
    const s = setup(XmaxEnvironment.global);
    try {
      await s.connect();
      s.payload.modelUid = undefined;
      await s.components.connectionManager.refreshCredentials();
      await s.change();
      expect(JSON.parse(s.relays()[0]![1].body as string).modelId).toBe("model-instance-1");
      await s.components.connectionManager.disconnect();
      s.payload.sessionUid = "session-2";
      s.payload.modelUid = "model-instance-2";
      await s.connect();
      await s.change("new session");
      expect(JSON.parse(s.relays()[1]![1].body as string)).toMatchObject({
        sessionId: "session-2", modelId: "model-instance-2",
      });
    } finally {
      await s.components.connectionManager.disconnect();
    }
  });

  it("does not wait for HTTP and cancels the old request when a new condition replaces it after an RTC ACK", async () => {
    const s = setup(XmaxEnvironment.china);
    try {
      await s.connect();
      s.fetch.mockImplementation((url, init) => {
        if (!url.endsWith("/client-event/relay")) {
          return Promise.resolve(new Response(JSON.stringify({ success: true, data: s.payload })));
        }
        return new Promise((_resolve, reject) => {
          init.signal!.addEventListener("abort", () => reject(new DOMException("Cancelled", "AbortError")), { once: true });
        });
      });
      await s.change();
      const oldRequest = s.relays()[0]![1];
      const xid = JSON.parse(oldRequest.body as string).data.xid;
      s.events()!.onCustomMessageReceived("bot-1", JSON.stringify({ event: "xid_ack", xid, count: 1 }));
      expect(oldRequest.signal!.aborted).toBe(false);
      await s.change("updated condition");
      expect(oldRequest.signal!.aborted).toBe(true);
      const nextRequest = s.relays()[1]![1];
      expect(nextRequest.signal!.aborted).toBe(false);
      await s.components.connectionManager.disconnect();
      expect(nextRequest.signal!.aborted).toBe(true);
    } finally {
      await s.components.connectionManager.disconnect();
    }
  });
});
