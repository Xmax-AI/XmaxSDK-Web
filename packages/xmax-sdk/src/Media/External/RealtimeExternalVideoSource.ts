//
//  RealtimeExternalVideoSource.ts
//  XmaxSDK
//
//  Author: 翁跃庭 (Yueting Weng)
//  GitHub: https://github.com/Xmax-AI/XmaxSDK-Web
//
//  Copyright (c) 2026 XMAX.AI PTE. LTD.
//

import type { RealtimeExternalAudioFrame } from "../../Foundation/Media/Audio/RealtimeExternalAudioFrame";
import type { RealtimeVideoFormat } from "../../Service/Realtime/RealtimeVideoFormat";

/**
 * 外部帧源与兼容视频轨入口二选一，禁止混用两套所有权和生命周期。
 */
export type RealtimeExternalVideoStreamOptions =
  | { source: RealtimeExternalVideoSource; videoTrack?: never; videoFormat?: never }
  | { videoTrack: MediaStreamTrack; videoFormat: RealtimeVideoFormat; source?: never };

/**
 * 接入方拥有的外部采集、解码或处理源；SDK 不申请设备权限，也不播放输入音频。
 * videoFormat 和 hasAudio 在一次绑定内保持不变，音视频时间戳使用同一单调时间轴。
 */
export interface RealtimeExternalVideoSource {

  /**
   * 原始视频尺寸、帧率及编码配置；方向和镜像由接入方处理到像素中。
   */
  readonly videoFormat: RealtimeVideoFormat;

  /**
   * 是否通过 sink 提交音频，默认 false。
   */
  readonly hasAudio?: boolean;

  /**
   * 安装帧回调并在源可交付后返回；不要等待首帧或生成开始。
   * 接入方按实时节奏提交，断开连接时可继续送视频以维持预览。
   */
  start(sink: RealtimeExternalFrameSink): Promise<void>;

  /**
   * 停止交付并解除 sink 引用，须可重复调用；采集设备及播放器仍归接入方管理。
   */
  stop(): Promise<void>;
}

/**
 * 一次外部源绑定的输入端；可在提交返回后 close 原帧，SDK 不接管原帧所有权。
 * VideoFrame.timestamp 和 AudioData.timestamp 均为非负微秒时间，不能跨循环或 seek 回退。
 */
export interface RealtimeExternalFrameSink {

  /**
   * 经过像素面积约束和 4 对齐的固定媒体规格；提交时仍使用 source.videoFormat 的尺寸。
   */
  readonly videoFormat: RealtimeVideoFormat;

  /**
   * 是否接受输入；断开时仍为 true，解绑或源失败后永久变为 false。
   */
  readonly isRequestingFrames: boolean;

  /**
   * 提交原始尺寸的视频帧；SDK 保留副本并缩放到媒体规格，不保证交付每个输入帧。
   * 重复、回退或无效时间戳被忽略。输入需按实时节奏送达，提前量不得超过两秒。
   */
  pushVideo(frame: VideoFrame): void;

  /**
   * 提交解码后的 PCM，仅 hasAudio=true 时接受；不接收压缩音频。
   * 支持 8–192 kHz、1–8 声道，单包不超过一秒；格式在一次绑定内保持不变。
   * SDK 复制并混成单声道，经 AudioWorklet 重采样和调度；仅发布期间上传，不缓存待重连。
   * 音频重叠或无效时间戳被忽略，间断在浏览器连续音轨中输出静音，不压缩时间轴。
   */
  pushAudio(frame: RealtimeExternalAudioFrame): void;

  /**
   * 上报不可恢复的采集或处理错误；SDK 结束连接并释放本地流。
   */
  reportError(error: Error): void;
}
