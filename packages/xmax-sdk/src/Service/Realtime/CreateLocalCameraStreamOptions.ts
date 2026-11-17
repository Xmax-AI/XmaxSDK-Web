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
 * Options for camera capture. Omit the preset and video format to use the model's default target.
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
   * Preferred camera input dimensions before rotation. The browser selects a supported format.
   * The frame rate defaults to the target frame rate, and the shared video uses the target dimensions.
   */
  captureFormat?: Pick<RealtimeVideoFormat, "width" | "height"> & Partial<Pick<RealtimeVideoFormat, "fps">>;

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
