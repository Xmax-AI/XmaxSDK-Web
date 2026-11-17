import { afterEach, describe, expect, it, vi } from "vitest";
import { MediaDevices } from "../src/index";

afterEach(() => vi.unstubAllGlobals());

describe("MediaDevices", () => {
  it("lists browser inputs and reads the selected camera without starting capture", async () => {
    const ranges = {
      width: { min: 1, max: 3840 },
      height: { min: 1, max: 2160 },
      frameRate: { min: 1, max: 60 },
    };
    const otherCamera = { kind: "videoinput", deviceId: "other", getCapabilities: vi.fn() };
    const camera = {
      kind: "videoinput",
      deviceId: "camera",
      getCapabilities: () => ({ ...ranges, facingMode: ["user"] }),
    };
    const microphone = { kind: "audioinput", deviceId: "microphone" };
    const speaker = { kind: "audiooutput", deviceId: "speaker" };
    const getUserMedia = vi.fn();
    vi.stubGlobal("navigator", {
      mediaDevices: {
        enumerateDevices: async () => [otherCamera, microphone, speaker, camera],
        getUserMedia,
      },
    });

    expect(await MediaDevices.listCameraDevices()).toEqual([otherCamera, camera]);
    expect(await MediaDevices.listMicrophoneDevices()).toEqual([microphone]);
    expect(await MediaDevices.getCameraCapabilities("camera")).toEqual(ranges);
    expect(otherCamera.getCapabilities).not.toHaveBeenCalled();
    expect(getUserMedia).not.toHaveBeenCalled();
  });

  it("handles hidden capabilities and devices the browser cannot enumerate", async () => {
    const enumerateDevices = vi.fn(async () => [
      { kind: "videoinput", deviceId: "", getCapabilities: () => ({}) },
      { kind: "videoinput", deviceId: "legacy-camera" },
      { kind: "videoinput", deviceId: "hidden-ranges", getCapabilities: () => ({}) },
    ]);
    const getUserMedia = vi.fn();
    vi.stubGlobal("navigator", { mediaDevices: { enumerateDevices, getUserMedia } });

    expect(await MediaDevices.getCameraCapabilities("")).toBeUndefined();
    expect(await MediaDevices.getCameraCapabilities("legacy-camera")).toBeUndefined();
    expect(await MediaDevices.getCameraCapabilities("hidden-ranges")).toBeUndefined();
    enumerateDevices.mockRejectedValue(new Error("Device enumeration is unavailable"));
    expect(await MediaDevices.listCameraDevices()).toEqual([]);
    expect(await MediaDevices.getCameraCapabilities("legacy-camera")).toBeUndefined();
    expect(getUserMedia).not.toHaveBeenCalled();
  });
});
