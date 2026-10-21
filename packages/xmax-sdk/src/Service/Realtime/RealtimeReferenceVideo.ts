//
//  RealtimeReferenceVideo.ts
//  XmaxSDK
//
//  Author: 翁跃庭 (Yueting Weng)
//  GitHub: https://github.com/Xmax-AI/XmaxSDK-Web
//
//  Copyright (c) 2026 XMAX.AI PTE. LTD.
//

/**
 * 服务端读取网络视频时使用的采样方式。
 */
export enum RealtimeVideoSampleMethod {

  /**
   * 按时间间隔采样网络视频。
   */
  time = "time",

  /**
   * 按指定帧率采样网络视频。
   */
  fps = "fps",
}

/**
 * 服务端可直接访问的网络视频及采样配置。
 */
export interface RealtimeReferenceVideo {

  /**
   * HTTP 或 HTTPS 视频地址。
   */
  readonly path: string;

  /**
   * 服务端采样方式。
   */
  readonly sampleMethod: RealtimeVideoSampleMethod;
}
