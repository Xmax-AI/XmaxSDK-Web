//
//  RealtimeExternalAudioFrame.ts
//  XmaxSDK
//
//  Author: 翁跃庭 (Yueting Weng)
//  GitHub: https://github.com/Xmax-AI/XmaxSDK-Web
//
//  Copyright (c) 2026 XMAX.AI PTE. LTD.
//

/**
 * 外部 PCM 帧的只读输入契约，浏览器 AudioData 可直接传入。
 * 使用结构类型，避免要求接入方额外安装 WebCodecs 全局类型。
 */
export interface RealtimeExternalAudioFrame {

  /**
   * 共用源时间轴上的微秒时间戳及固定 PCM 规格。
   */
  readonly timestamp: number;
  readonly sampleRate: number;
  readonly numberOfChannels: number;
  readonly numberOfFrames: number;
  readonly format: string | null;

  /**
   * 将指定声道复制为平面浮点 PCM；返回后 SDK 不再访问原始样本。
   */
  copyTo(destination: Float32Array, options: { planeIndex: number; format: "f32-planar" }): void;
}
