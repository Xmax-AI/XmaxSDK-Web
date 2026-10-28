//
//  RealtimeContext.ts
//  XmaxSDK
//
//  Author: 翁跃庭 (Yueting Weng)
//  GitHub: https://github.com/Xmax-AI/XmaxSDK-Web
//
//  Copyright (c) 2026 XMAX.AI PTE. LTD.
//

/**
 * Text conditions and reference media for realtime generation.
 */
export interface RealtimeContextInit {

  /**
   * The text prompt used for generation.
   */
  prompt: string;

  /**
   * The remote path of an uploaded reference image.
   */
  referencePath?: string;
}

/**
 * The prompt and reference media for a realtime task.
 */
export class RealtimeContext {

  /**
   * The text prompt used for generation.
   */
  readonly prompt: string;

  /**
   * The remote path of an uploaded reference image.
   */
  readonly referencePath?: string;

  /**
   * Creates realtime generation conditions.
   */
  constructor(
    init: RealtimeContextInit
  ) {
    this.prompt = init.prompt.trim();
    const normalizedReferencePath = init.referencePath?.trim();
    this.referencePath = normalizedReferencePath || undefined;
  }
}
