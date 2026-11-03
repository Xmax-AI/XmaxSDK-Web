import { afterEach, describe, expect, it, vi } from "vitest";
import {
  XmaxClient,
  XmaxConfiguration,
  XmaxEnvironment,
  XmaxErrorCode,
  type XmaxCreditBalance,
} from "../src/index";

function setup(environment = XmaxEnvironment.china, apiKey = "  balance-key\n") {
  const fetch = vi.fn(async (_url: RequestInfo | URL, _init?: RequestInit) =>
    new Response(JSON.stringify({ success: true, code: 200, data: { currentBalance: 1250.75 } }), { status: 200 }));
  vi.stubGlobal("fetch", fetch);
  const client = new XmaxClient(new XmaxConfiguration({ apiKey, environment }));
  return { client, fetch };
}

afterEach(() => vi.unstubAllGlobals());

describe("XmaxClient.getCreditBalance", () => {
  it.each([
    [XmaxEnvironment.china, "https://cloud.xmax.22duck.cn/open/api/v1/balance"],
    [XmaxEnvironment.global, "https://api.xmax.cloud/open/api/v1/balance"],
  ] as const)("uses API-key authentication and the general %s endpoint", async (environment, endpoint) => {
    const s = setup(environment);
    expect(s.fetch).not.toHaveBeenCalled();
    const result: XmaxCreditBalance = await s.client.getCreditBalance();
    expect(result).toEqual({ currentBalance: 1250.75 });
    expect(Object.isFrozen(result)).toBe(true);
    expect(s.fetch).toHaveBeenCalledOnce();
    const [url, request] = s.fetch.mock.calls[0]!;
    expect(url).toBe(endpoint);
    expect(request?.method).toBe("GET");
    expect(request?.body).toBeUndefined();
    expect(request?.cache).toBe("no-store");
    expect(request?.headers).toMatchObject({ "X-Api-Key": "balance-key", "X-Platform": "web" });
    expect(request?.headers).not.toHaveProperty("Authorization");
  });

  it("queries a fresh balance on every call and retains fractional credits", async () => {
    const s = setup();
    const first = await s.client.getCreditBalance();
    s.fetch.mockResolvedValueOnce(new Response(JSON.stringify({ success: true, data: { currentBalance: 25.5 } })));
    const second = await s.client.getCreditBalance();
    expect(first.currentBalance).toBe(1250.75);
    expect(second.currentBalance).toBe(25.5);
    expect(s.fetch).toHaveBeenCalledTimes(2);
    expect(s.fetch.mock.calls.every(([, options]) => options?.cache === "no-store")).toBe(true);
  });

  it("accepts a server-confirmed zero balance", async () => {
    const s = setup();
    s.fetch.mockResolvedValueOnce(new Response('{"success":true,"data":{"currentBalance":0}}'));
    await expect(s.client.getCreditBalance()).resolves.toEqual({ currentBalance: 0 });
  });

  it("rejects an empty API key before sending a request", async () => {
    const s = setup(XmaxEnvironment.china, " \n ");
    await expect(s.client.getCreditBalance()).rejects.toMatchObject({ code: XmaxErrorCode.invalidAPIKey });
    expect(s.fetch).not.toHaveBeenCalled();
  });

  it.each([
    "null", "{}", "[]", "true", "1", '"1250.75"',
    '{"currentBalance":null}', '{"currentBalance":true}', '{"currentBalance":"1250.75"}',
    '{"currentBalance":-1}', '{"currentBalance":1e400}', '{"currentBalance":[]}',
  ])("rejects missing or invalid balance data rather than returning zero: %s", async payload => {
    const s = setup();
    s.fetch.mockResolvedValueOnce(new Response(`{"success":true,"data":${payload}}`));
    await expect(s.client.getCreditBalance()).rejects.toMatchObject({ code: XmaxErrorCode.apiError });
  });

  it.each([200, 401])("preserves server errors and HTTP status %s", async status => {
    const s = setup();
    s.fetch.mockResolvedValueOnce(new Response(
      '{"success":false,"code":46002,"message":"Invalid API key","data":null}', { status }));
    await expect(s.client.getCreditBalance()).rejects.toMatchObject({
      code: XmaxErrorCode.apiError, apiCode: 46002, httpStatus: status, message: "Invalid API key",
    });
  });

  it("propagates malformed response envelopes", async () => {
    const s = setup();
    s.fetch.mockResolvedValueOnce(new Response("not-json"));
    await expect(s.client.getCreditBalance()).rejects.toMatchObject({ code: XmaxErrorCode.apiError, httpStatus: 200 });
  });

  it.each([
    [new TypeError("Failed to fetch"), XmaxErrorCode.networkError],
    [new DOMException("Cancelled", "AbortError"), XmaxErrorCode.cancelled],
    [new DOMException("Timed out", "TimeoutError"), XmaxErrorCode.timeout],
  ])("preserves transport error classification: %s", async (error, code) => {
    const s = setup();
    s.fetch.mockRejectedValueOnce(error);
    await expect(s.client.getCreditBalance()).rejects.toMatchObject({ code });
  });
});
