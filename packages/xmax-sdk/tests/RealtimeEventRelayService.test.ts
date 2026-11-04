import { afterEach, describe, expect, it, vi } from "vitest";
import { XmaxErrorCode } from "../src/Foundation/Errors/XmaxError";
import { ApiService, type ApiFetch } from "../src/Service/Network/ApiService";
import { RealtimeEventRelayService } from "../src/Service/Realtime/RealtimeEventRelayService";

function setup(data: unknown = { xid: "command-1", accepted: true }) {
  const fetch = vi.fn<ApiFetch>(async () => new Response(JSON.stringify({ success: true, code: 200, data })));
  const service = new RealtimeEventRelayService(new ApiService({
    apiKey: " relay-key ",
    baseURL: "https://relay.example/open/api/v1",
    fetchImpl: fetch,
  }));
  const abort = new AbortController();
  const options = {
    sessionID: "session-1",
    modelID: "model-instance-1",
    data: {
      event: "start",
      xid: "command-1",
      uid: "task-1",
      params: { prompt: "a cat", size: [1920, 1080], static_generate: true },
      runtime: { platform: "web" },
    },
    signal: abort.signal,
  };
  return { service, fetch, abort, options };
}

afterEach(() => vi.restoreAllMocks());

describe("RealtimeEventRelayService", () => {
  it.each([false, true])("sends the complete payload once and accepts accepted=%s", async accepted => {
    const s = setup({ xid: "command-1", accepted });
    await s.service.relay(s.options);
    expect(s.fetch).toHaveBeenCalledOnce();
    const [url, init] = s.fetch.mock.calls[0]!;
    expect(url).toBe("https://relay.example/open/api/v1/client-event/relay");
    expect(init.method).toBe("POST");
    expect(init.headers["X-Api-Key"]).toBe("relay-key");
    expect(JSON.parse(init.body!)).toEqual({
      sessionId: "session-1", modelId: "model-instance-1", data: s.options.data,
    });
    expect(JSON.parse(init.body!).data).not.toHaveProperty("index");
  });

  it.each([
    null, {}, [], { xid: "another-command", accepted: true },
    { xid: "command-1" }, { xid: "command-1", accepted: "true" },
  ])("rejects an invalid relay response without retrying: %j", async response => {
    const s = setup(response);
    await expect(s.service.relay(s.options)).rejects.toMatchObject({ code: XmaxErrorCode.apiError });
    expect(s.fetch).toHaveBeenCalledOnce();
  });

  it.each([200, 503])("preserves business errors at HTTP status %s without retrying", async status => {
    const s = setup();
    s.fetch.mockResolvedValueOnce(new Response(
      '{"success":false,"code":46015,"message":"Model binding mismatch","data":null}', { status },
    ));
    await expect(s.service.relay(s.options)).rejects.toMatchObject({
      code: XmaxErrorCode.apiError, apiCode: 46015, httpStatus: status,
    });
    expect(s.fetch).toHaveBeenCalledOnce();
  });

  it.each([
    [new TypeError("Failed to fetch"), XmaxErrorCode.networkError],
    [new DOMException("Timed out", "TimeoutError"), XmaxErrorCode.timeout],
  ])("preserves transport failure without retrying: %s", async (error, code) => {
    const s = setup();
    s.fetch.mockRejectedValueOnce(error);
    await expect(s.service.relay(s.options)).rejects.toMatchObject({ code });
    expect(s.fetch).toHaveBeenCalledOnce();
  });

  it("does not start a request after cancellation", async () => {
    const s = setup();
    s.abort.abort();
    await expect(s.service.relay(s.options)).rejects.toMatchObject({ code: XmaxErrorCode.cancelled });
    expect(s.fetch).not.toHaveBeenCalled();
  });

  it("cancels the in-flight fetch on task cleanup", async () => {
    const s = setup();
    s.fetch.mockImplementationOnce((_url, init) => new Promise((_resolve, reject) => {
      init.signal!.addEventListener("abort", () => reject(new DOMException("Cancelled", "AbortError")), { once: true });
    }));
    const pending = s.service.relay(s.options);
    const failed = expect(pending).rejects.toMatchObject({ code: XmaxErrorCode.cancelled });
    const signal = s.fetch.mock.calls[0]![1].signal!;
    s.abort.abort();
    await failed;
    expect(signal.aborted).toBe(true);
    expect(s.fetch).toHaveBeenCalledOnce();
  });
});
