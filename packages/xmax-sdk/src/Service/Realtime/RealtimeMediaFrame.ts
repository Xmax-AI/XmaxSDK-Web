//
//  RealtimeMediaFrame.ts
//  XmaxSDK
//
//  Author: 翁跃庭 (Yueting Weng)
//  GitHub: https://github.com/Xmax-AI/XmaxSDK-Web
//
//  Copyright (c) 2026 XMAX.AI PTE. LTD.
//

/**
 * 已复制的远端 PCM 音频包，格式为有符号、小端、交错排列的 16 位样本。
 */
export interface RealtimeAudioFrame {

  /**
   * 音频字节；回调返回后仍可持有。
   */
  readonly data: Uint8Array;

  /**
   * 每个声道每秒的样本数。
   */
  readonly sampleRate: number;

  /**
   * 交错排列的声道数。
   */
  readonly channels: number;

  /**
   * 本包每个声道的样本数。
   */
  readonly samplesPerChannel: number;

  /**
   * 首个样本在接收端呈现时间轴上的时间，单位为微秒，不保证从零开始。
   */
  readonly presentationTimeStamp: number;

  /**
   * 按样本数和采样率计算的时长，单位为微秒。
   */
  readonly duration: number;
}

/**
 * 原始远端解码视频帧，不包含客户端插帧、镜像、裁剪或界面叠层。
 */
export interface RealtimeVideoFrame {

  /**
   * 由接入方持有的只读帧；使用或异步编码完成后必须调用 close()。
   */
  readonly frame: VideoFrame;

  /**
   * 接收端呈现时间轴上的时间，单位为微秒，与音频使用相同时间基准。
   */
  readonly presentationTimeStamp: number;

  /**
   * 建议呈现时长，单位为微秒；无法确定时为空。
   */
  readonly duration?: number;
}

/**
 * 一包远端媒体，不表示一对音视频帧；按同一个录制起点和时间戳进行同步。
 */
export interface RealtimeMediaFrame {

  /**
   * 同一结果流绑定的音视频共享标识；换流或重连后更新。
   */
  readonly streamID: string;

  /**
   * 当前轨首次输出、格式/时钟变化或丢弃输出后为 true；SDK 不压缩时间轴。
   */
  readonly isDiscontinuous: boolean;

  /**
   * 音频包或视频帧。
   */
  readonly content:
    | { readonly type: "audio"; readonly frame: RealtimeAudioFrame }
    | { readonly type: "video"; readonly frame: RealtimeVideoFrame };

  /**
   * 媒体时间戳，单位为微秒，与 content.frame.presentationTimeStamp 一致。
   */
  readonly presentationTimeStamp: number;

  /**
   * 包时长，单位为微秒；视频无法确定时为空。
   */
  readonly duration?: number;
}

/**
 * 按交付顺序接收媒体，不保证跨音视频轨的时间戳顺序。
 * 回调须保持轻量，异步处理请自行排队；视频帧所有权转移给接入方，音频可直接保留。
 */
export type RealtimeMediaFrameListener = (frame: RealtimeMediaFrame) => void;
