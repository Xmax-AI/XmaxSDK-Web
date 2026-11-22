import { beforeEach, describe, expect, it, vi } from "vitest";
import { XmaxErrorCode } from "../src/Foundation/Errors/XmaxError";
import { RoomJoinConfiguration } from "../src/Foundation/RTC/RoomJoinConfiguration";
import { TrtcRtcManager } from "../src/Foundation/RTC/TRTC/TrtcRtcManager";

const { setLogLevel, create } = vi.hoisted(() => ({
  setLogLevel: vi.fn(),
  create: vi.fn(),
}));

vi.mock("trtc-sdk-v5", () => ({ default: { setLogLevel, create } }));

function makeEngine() {
  return {
    on: vi.fn(), off: vi.fn(), destroy: vi.fn(),
    enterRoom: vi.fn(async () => {}), exitRoom: vi.fn(async () => {}),
    stopLocalAudio: vi.fn(async () => {}), stopLocalVideo: vi.fn(async () => {}),
  };
}

const credentials = new RoomJoinConfiguration({
  roomID: "room", userID: "user", sdkAppID: "12345", userSig: "sig", privateMapKey: "key",
});

describe("TrtcRtcManager lifecycle", () => {
  beforeEach(() => {
    setLogLevel.mockReset();
    create.mockReset().mockImplementation(makeEngine);
  });

  it("disables vendor console logs before creating each engine without disabling diagnostic upload", async () => {
    const manager = new TrtcRtcManager();
    await manager.initialize();
    expect(setLogLevel).toHaveBeenCalledTimes(1);
    expect(setLogLevel).toHaveBeenCalledWith(5);
    expect(setLogLevel.mock.invocationCallOrder[0]!).toBeLessThan(create.mock.invocationCallOrder[0]!);
    await manager.destroy();

    await manager.initialize();
    expect(setLogLevel).toHaveBeenCalledTimes(2);
    expect(setLogLevel).toHaveBeenLastCalledWith(5);
    expect(setLogLevel.mock.invocationCallOrder[1]!).toBeLessThan(create.mock.invocationCallOrder[1]!);
    await manager.destroy();
  });

  it("deduplicates initialization per adapter and lets separate adapters hold clients concurrently", async () => {
    const loadSDK = vi.fn(async () => ({ setLogLevel, create }));
    const first = new TrtcRtcManager({ loadSDK });
    const second = new TrtcRtcManager({ loadSDK });
    await Promise.all([first.initialize(), first.initialize(), second.initialize()]);

    expect(loadSDK).toHaveBeenCalledTimes(2);
    expect(create).toHaveBeenCalledTimes(2);
    expect(first.isInitialized).toBe(true);
    expect(second.isInitialized).toBe(true);
    const engines = create.mock.results.map(result => result.value as ReturnType<typeof makeEngine>);
    await Promise.all([first.joinRoom(credentials), second.joinRoom({ ...credentials, roomID: "other-room" })]);
    for (const engine of engines) expect(engine.enterRoom).toHaveBeenCalledOnce();

    await first.destroy();
    const destroyed = engines.filter(engine => engine.destroy.mock.calls.length);
    expect(destroyed).toHaveLength(1);
    expect(destroyed[0]?.exitRoom).toHaveBeenCalledOnce();
    expect(second.isInitialized).toBe(true);
    await second.destroy();
    for (const engine of engines) expect(engine.destroy).toHaveBeenCalledOnce();
  });

  it("invalidates initialization on destroy and allows a later initialize call", async () => {
    const sdk = { setLogLevel, create };
    let finishLoading!: (value: typeof sdk) => void;
    const loadSDK = vi.fn(async () => sdk)
      .mockImplementationOnce(() => new Promise(resolve => { finishLoading = resolve; }));
    const manager = new TrtcRtcManager({ loadSDK });
    const cancelled = expect(manager.initialize()).rejects.toMatchObject({ code: XmaxErrorCode.cancelled });
    await manager.destroy();
    await manager.initialize();
    finishLoading(sdk);
    await cancelled;
    expect(create).toHaveBeenCalledOnce();
    expect(manager.isInitialized).toBe(true);
    await manager.destroy();
  });

  it("exits a room that finishes joining during destroy before destroying its engine", async () => {
    const engine = makeEngine();
    create.mockReturnValueOnce(engine);
    let finishJoining!: () => void;
    engine.enterRoom.mockImplementationOnce(() => new Promise(resolve => { finishJoining = resolve; }));
    const manager = new TrtcRtcManager();
    await manager.initialize();
    const cancelled = expect(manager.joinRoom(credentials)).rejects.toMatchObject({ code: XmaxErrorCode.cancelled });
    const destroyed = manager.destroy();
    expect(engine.exitRoom).not.toHaveBeenCalled();
    expect(engine.destroy).not.toHaveBeenCalled();
    finishJoining();
    await Promise.all([cancelled, destroyed]);
    expect(engine.exitRoom).toHaveBeenCalledOnce();
    expect(engine.destroy).toHaveBeenCalledOnce();
    expect(engine.exitRoom.mock.invocationCallOrder[0]!).toBeLessThan(engine.destroy.mock.invocationCallOrder[0]!);
  });

  it.each([true, false])("cancels pending join on leave and allows reentry (late join succeeds: %s)", async (succeeds) => {
    const engine = makeEngine();
    create.mockReturnValueOnce(engine);
    let finishJoining!: () => void;
    engine.enterRoom.mockImplementationOnce(() => new Promise<void>((resolve, reject) => {
      finishJoining = succeeds ? resolve : () => reject(new Error("join failed"));
    }));
    const manager = new TrtcRtcManager();
    const listener = { onRemoteVideoPublished: vi.fn(), onCustomMessageReceived: vi.fn() };
    manager.setEventListener(listener);
    await manager.initialize();

    const cancelled = expect(manager.joinRoom(credentials)).rejects.toMatchObject({ code: XmaxErrorCode.cancelled });
    const leaving = Promise.all([manager.leaveRoom(), manager.leaveRoom()]);
    expect(engine.exitRoom).not.toHaveBeenCalled();
    const remoteVideoEvent = engine.on.mock.calls.find(([event]) => event === "remote-video-available")?.[1];
    remoteVideoEvent({ userId: "old", streamType: "main" });
    expect(listener.onRemoteVideoPublished).not.toHaveBeenCalled();

    finishJoining();
    await Promise.all([cancelled, leaving]);
    expect(engine.exitRoom).toHaveBeenCalledTimes(succeeds ? 1 : 0);
    await manager.joinRoom({ ...credentials, roomID: "next" });
    expect(engine.enterRoom).toHaveBeenCalledTimes(2);
    expect(engine.enterRoom).toHaveBeenLastCalledWith(expect.objectContaining({ strRoomId: "next" }));
    remoteVideoEvent({ userId: "new", streamType: "main" });
    expect(listener.onRemoteVideoPublished).toHaveBeenCalledWith("new", true);
    await manager.destroy();
  });
});
