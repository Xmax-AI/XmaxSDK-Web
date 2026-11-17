//
//  RealtimeMicrophone.ts
//  XmaxSDK
//
//  Author: 翁跃庭 (Yueting Weng)
//  GitHub: https://github.com/Xmax-AI/XmaxSDK-Web
//
//  Copyright (c) 2026 XMAX.AI PTE. LTD.
//

/**
 * The microphone input to use when a camera stream connects.
 */
export type RealtimeMicrophone =
  | { readonly kind: "disabled" }
  | { readonly kind: "systemDefault" }
  | { readonly kind: "device"; readonly id: string };

/**
 * Provides microphone selections for a local camera stream.
 */
export const RealtimeMicrophone = Object.freeze({

  /**
   * Leaves microphone permission, capture, and publication disabled.
   */
  disabled: Object.freeze({ kind: "disabled" } as const),

  /**
   * Uses the browser's default microphone.
   */
  systemDefault: Object.freeze({ kind: "systemDefault" } as const),

  /**
   * Selects a microphone by its browser device ID.
   */
  device(
    id: string
  ): RealtimeMicrophone {
    return { kind: "device", id };
  }
});
