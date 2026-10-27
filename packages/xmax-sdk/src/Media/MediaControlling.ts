//
//  MediaControlling.ts
//  XmaxSDK
//
//  Author: 翁跃庭 (Yueting Weng)
//  GitHub: https://github.com/Xmax-AI/XmaxSDK-Web
//
//  Copyright (c) 2026 XMAX.AI PTE. LTD.
//

import type { CameraControlling, CameraPreviewReadyHandler } from "./Camera/CameraControlling";
import type { LocalVideoController } from "./Video/LocalVideoController";
import type { RealtimeExternalVideoStreamOptions } from "./External/RealtimeExternalVideoSource";
import type { LocalImageController } from "./Image/LocalImageController";
import type { InteractionControlling } from "./Interaction/InteractionControlling";
import type { RealtimeVideoTrack } from "../Service/Realtime/RealtimeVideoTrack";
import type { RealtimeMediaStream } from "../Service/Realtime/RealtimeMediaStream";
import type { RealtimeVideoFormat } from "../Service/Realtime/RealtimeVideoFormat";

/**
 * 媒体层统一入口，不向 Core 暴露内部媒体控制器。
 */
export interface MediaControlling extends InteractionControlling {

  /**
   * 当前活动媒体源的可发布视频轨道。
   */
  readonly currentTrack?: RealtimeVideoTrack;

  /**
   * 当前活动媒体源类型。
   */
  readonly source?: "camera" | "localVideo" | "localImage" | "externalVideo";

  /**
   * 当前媒体源是否提供可发布的音频轨。
   */
  readonly hasAudio: boolean;

  /**
   * 是否在摄像头发布前等待亮度合格的帧。
   */
  readonly isFrameValidationEnabled: boolean;

  /**
   * 验证没有活动或正在准备的本地媒体。
   */
  ensureNoLocalSource(): void;

  /**
   * 验证 RTC 支持外部媒体输入。
   */
  validateExternalMediaSupport(
    kind: "local" | "external" | "image"
  ): void;

  /**
   * 创建相机采集及预览。
   */
  createLocalCameraStream(
    options: Parameters<CameraControlling["createLocalCameraStream"]>[0]
  ): Promise<RealtimeMediaStream>;

  /**
   * 更新当前摄像头媒体规格，其他媒体源不支持。
   */
  updateCameraFormat(
    videoFormat: RealtimeVideoFormat
  ): Promise<void>;

  /**
   * 创建文件视频源并解锁播放，RTC 初始化由 prepareSource 完成。
   */
  createLocalVideoStream(
    options: Parameters<LocalVideoController["create"]>[0],
    signal: AbortSignal
  ): Promise<RealtimeMediaStream>;

  /**
   * 创建本地图片静止视频源，RTC 初始化由 prepareSource 完成。
   */
  createLocalImageStream(
    options: Parameters<LocalImageController["create"]>[0],
    signal: AbortSignal
  ): Promise<RealtimeMediaStream>;

  /**
   * 绑定外部帧源或克隆外部轨道，RTC 初始化由 prepareSource 完成。
   */
  createExternalVideoStream(
    options: RealtimeExternalVideoStreamOptions,
    signal: AbortSignal
  ): Promise<RealtimeMediaStream>;

  /**
   * 外部音频仅在 RTC 发布完成后开始调度；断开立即清空待发送音频。
   */
  setExternalAudioPublished(published: boolean): void;

  /**
   * 初始化当前非相机源的 RTC 并安装外部轨道，每个异步边界检查操作有效性。
   */
  prepareSource(
    ensureCurrent: () => void
  ): Promise<void>;

  /**
   * 设置相机预览就绪通知。
   */
  setCameraPreviewReadyHandler(
    handler?: CameraPreviewReadyHandler
  ): void;

  /**
   * 等待相机预热，可随连接取消。
   */
  waitForValidCameraFrame(
    signal: AbortSignal
  ): Promise<void>;

  /**
   * 切换相机，外部轨道由调用方管理。
   */
  switchCamera(): Promise<RealtimeMediaStream>;

  /**
   * 停止相机并释放其资源。
   */
  stopLocalCameraStream(): Promise<void>;

  /**
   * 生成开始后启动文件视频播放。
   */
  startLocalVideo(
    signal: AbortSignal
  ): Promise<void>;

  /**
   * 暂停文件视频，保留本地资源。
   */
  pauseLocalVideo(): void;

  /**
   * 释放当前源和 RTC，任何失败都不跳过本地轨道清理。
   */
  stopLocalStream(): Promise<void>;
}
