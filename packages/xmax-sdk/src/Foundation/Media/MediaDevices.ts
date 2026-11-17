//
//  MediaDevices.ts
//  XmaxSDK
//
//  Author: 翁跃庭 (Yueting Weng)
//  GitHub: https://github.com/Xmax-AI/XmaxSDK-Web
//
//  Copyright (c) 2026 XMAX.AI PTE. LTD.
//

/** Lists the inputs of the requested kind that the browser exposes to this page. */
async function listInputDevices(
  kind: "videoinput" | "audioinput"
): Promise<MediaDeviceInfo[]> {
  const devices = globalThis.navigator?.mediaDevices;
  if (!devices?.enumerateDevices) {
    return [];
  }
  try {
    const inputs = await devices.enumerateDevices();
    return inputs.filter(device => device.kind === kind);
  } catch {
    return [];
  }
}

/** Queries local media devices without requesting permission or starting capture. */
export const MediaDevices = Object.freeze({

  /**
   * Lists the cameras exposed by the browser. The browser may hide IDs and labels before permission
   * is granted.
   */
  listCameraDevices(): Promise<MediaDeviceInfo[]> {
    return listInputDevices("videoinput");
  },

  /**
   * Lists the microphones exposed by the browser. The browser may hide IDs and labels before
   * permission is granted.
   */
  listMicrophoneDevices(): Promise<MediaDeviceInfo[]> {
    return listInputDevices("audioinput");
  },

  /**
   * Reads the available width, height, and frame-rate ranges for a camera.
   * @param deviceId - The browser device ID returned by listCameraDevices().
   * @returns The reported ranges, or undefined when the browser does not provide them.
   */
  async getCameraCapabilities(
    deviceId: string
  ): Promise<Pick<MediaTrackCapabilities, "width" | "height" | "frameRate"> | undefined> {
    if (!deviceId) {
      return undefined;
    }

    const cameras = await listInputDevices("videoinput");
    const camera = cameras.find(device => device.deviceId === deviceId) as InputDeviceInfo | undefined;
    try {
      const { width, height, frameRate } = camera?.getCapabilities?.() ?? {};
      return width || height || frameRate ? { width, height, frameRate } : undefined;
    } catch {
      return undefined;
    }
  }
});
