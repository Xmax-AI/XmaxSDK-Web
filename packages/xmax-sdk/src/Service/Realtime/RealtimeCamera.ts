//
//  RealtimeCamera.ts
//  XmaxSDK
//
//  Author: 翁跃庭 (Yueting Weng)
//  GitHub: https://github.com/Xmax-AI/XmaxSDK-Web
//
//  Copyright (c) 2026 XMAX.AI PTE. LTD.
//

import type { CameraPosition } from "../../Foundation/Media/Camera/CameraPosition";

/**
 * A camera selected by facing direction or browser device ID.
 */
export type RealtimeCamera =
  | { readonly kind: "position"; readonly position: CameraPosition }
  | { readonly kind: "device"; readonly id: string };

/**
 * Creates a camera selection for a local stream.
 */
export const RealtimeCamera = Object.freeze({

  /**
   * Requests a front or rear camera.
   */
  position(
    position: CameraPosition
  ): RealtimeCamera {
    return { kind: "position", position };
  },

  /**
   * Selects a camera by its browser device ID.
   */
  device(
    id: string
  ): RealtimeCamera {
    return { kind: "device", id };
  }
});
