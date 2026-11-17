//
//  CreateLocalCameraStreamOptions.ts
//  XmaxSDK
//
//  Author: 翁跃庭 (Yueting Weng)
//  GitHub: https://github.com/Xmax-AI/XmaxSDK-Web
//
//  Copyright (c) 2026 XMAX.AI PTE. LTD.
//

import type { CameraRotation } from "../../Foundation/Media/Camera/CameraRotation";
import type { RealtimeCamera } from "./RealtimeCamera";
import type { RealtimeCameraPreset } from "./RealtimeCameraPreset";
import type { RealtimeMicrophone } from "./RealtimeMicrophone";
import type { RealtimeVideoFormat } from "./RealtimeVideoFormat";

/**
 * Options for camera capture. Omit both video settings to use the model's default camera format.
 */
export type CreateLocalCameraStreamOptions = (
  | {

    /**
     * The model-supported preset and its recommended frame rate.
     */
    preset: RealtimeCameraPreset;
    videoFormat?: never;
  }
  | {

    /**
     * The target format after camera rotation.
     */
    videoFormat?: RealtimeVideoFormat;
    preset?: never;
  }
) & {

  /**
   * The selected camera. Defaults to a front-facing preference.
   */
  camera?: RealtimeCamera;

  /**
   * The microphone used during connection. Defaults to disabled.
   */
  microphone?: RealtimeMicrophone;

  /**
   * The clockwise rotation in degrees. Defaults to zero.
   */
  rotation?: CameraRotation;

  /**
   * Whether to mirror pixels after rotation. Omit to mirror a front camera. When selecting by ID
   * and the facing direction is unknown, the system default camera is mirrored.
   */
  mirror?: boolean;

  /**
   * The additional warmup before publication in milliseconds. Accepts a finite, non-negative value
   * and defaults to zero.
   */
  warmupMs?: number;
};
