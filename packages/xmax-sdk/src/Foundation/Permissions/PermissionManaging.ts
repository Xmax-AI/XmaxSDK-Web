//
//  PermissionManaging.ts
//  XmaxSDK
//
//  Author: 翁跃庭 (Yueting Weng)
//  GitHub: https://github.com/Xmax-AI/XmaxSDK-Web
//
//  Copyright (c) 2026 XMAX.AI PTE. LTD.
//

/**
 * Camera and microphone permission checks.
 */
export interface PermissionManaging {

  /**
   * Checks camera permission availability.
   *
   * @throws Rejects with cameraPermissionDenied if permission is denied or unavailable.
   */
  ensureCameraPermission(): Promise<void>;

  /**
   * Checks microphone permission availability.
   *
   * @throws Rejects with microphonePermissionDenied if permission is denied or unavailable.
   */
  ensureMicrophonePermission(): Promise<void>;
}
