//
//  PermissionManager.ts
//  XmaxSDK
//
//  Author: 翁跃庭 (Yueting Weng)
//  GitHub: https://github.com/Xmax-AI/XmaxSDK-Web
//
//  Copyright (c) 2026 XMAX.AI PTE. LTD.
//

import { XmaxError, XmaxErrorCode } from "../Errors/XmaxError";
import { XmaxLogger } from "../Logging/XmaxLogger";
import type { PermissionManaging } from "./PermissionManaging";

/**
 * Preflights browser media permissions.
 *
 * getUserMedia requests permission during capture. Unsupported Permissions API queries are skipped,
 * leaving capture-time DOMException mapping to report failures.
 */
export class PermissionManager implements PermissionManaging {

  /**
   * Checks camera permission availability.
   *
   * @throws Rejects with cameraPermissionDenied if permission is denied or capture is unsupported.
   */
  async ensureCameraPermission(): Promise<void> {
    await this.ensurePermission(
      "camera",
      XmaxErrorCode.cameraPermissionDenied
    );
  }

  /**
   * Checks microphone permission availability.
   *
   * @throws Rejects with microphonePermissionDenied if permission is denied or capture is unsupported.
   */
  async ensureMicrophonePermission(): Promise<void> {
    await this.ensurePermission(
      "microphone",
      XmaxErrorCode.microphonePermissionDenied,
    );
  }

  /**
   * Preflights device permission through the Permissions API.
   *
   * @param name - The media permission name.
   * @param deniedCode - The error code for denied permission.
   */
  private async ensurePermission(
    name: "camera" | "microphone",
    deniedCode: XmaxErrorCode,
  ): Promise<void> {
    if (typeof navigator === "undefined" || !navigator.mediaDevices?.getUserMedia) {
      throw new XmaxError(
        deniedCode,
        "This browser does not support media capture (getUserMedia)",
      );
    }

    try {
      const permissions = navigator.permissions;
      if (!permissions?.query) {
        return;
      }
      // Query media permissions by runtime capability rather than DOM type-library coverage.
      const status = await permissions.query({
        name: name as PermissionName,
      });
      if (status.state === "denied") {
        throw new XmaxError(
          deniedCode,
          `${name === "camera" ? "Camera" : "Microphone"} permission was denied`,
        );
      }
    } catch (error) {
      if (error instanceof XmaxError) {
        throw error;
      }
      // Skip unsupported browser permission queries.
      XmaxLogger.permission.debug(
        () => `Permission query for ${name} is unavailable; skip pre-check`,
      );
    }
  }
}
