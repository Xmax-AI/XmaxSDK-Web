//
//  FramegenRuntime.d.ts
//  XmaxSDK
//
//  Author: 翁跃庭 (Yueting Weng)
//  GitHub: https://github.com/Xmax-AI/XmaxSDK-Web
//
//  Copyright (c) 2026 XMAX.AI PTE. LTD.
//

/**
 * framegen 1.4.0 的 exports 未导出类型声明；限定本 SDK 使用的 texture API。
 */
declare module "framegen" {
  /**
   * 插帧运行时使用的 GPU 纹理接口。
   */
  export interface RT {

    /**
     * 准备相邻两张原始帧的 GPU 纹理。
     */
    prepPair(
      a: GPUTexture,
      b: GPUTexture
    ): void;

    /**
     * 按两帧之间的位置计算中间帧，并写入目标纹理。
     */
    runT(
      t: number,
      output: GPUTexture
    ): void;

    /**
     * 释放插帧运行时持有的 GPU 资源。
     */
    destroy(): void;
  }
  /**
   * 按目标尺寸和权重创建 GPU 插帧运行时。
   */
  export function createRT(
    device: GPUDevice,
    options: {
      w: number;
      h: number;
      weightsBin: ArrayBuffer;
      weightsManifest: Record<string, {
        offset: number;
        shape: number[]
      }>;
      textureInput: boolean;
      textureOutput: boolean;
      staticGuard: boolean;
    }
  ): Promise<RT>;
}
