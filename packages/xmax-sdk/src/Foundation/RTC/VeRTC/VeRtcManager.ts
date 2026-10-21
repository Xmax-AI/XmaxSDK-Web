//
//  VeRtcManager.ts
//  XmaxSDK
//
//  Author: 翁跃庭 (Yueting Weng)
//  GitHub: https://github.com/Xmax-AI/XmaxSDK-Web
//
//  Copyright (c) 2026 XMAX.AI PTE. LTD.
//

import { RtcProvider } from "../RtcProvider";
import type { IRTCEngine } from "@volcengine/rtc";
import { XmaxError, XmaxErrorCode } from "../../Errors/XmaxError";
import { XmaxLogger, XmaxLoggerOption } from "../../Logging/XmaxLogger";
import { CameraPosition } from "../../Media/Camera/CameraPosition";
import type { RtcManaging, RtcCameraCaptureOptions } from "../RtcManaging";
import type { RtcEventListener } from "../RtcEventListener";
import type { RtcRoomJoinConfiguration, VeRtcRoomJoinConfiguration } from "../RoomJoinConfiguration";
import { RtcVideoEncoderPreference, type VideoEncodingConfiguration } from "../VideoEncodingConfiguration";
import { rtcOrientedVideoSize } from "../RtcVideoOrientation";
import type { RemoteVideoStatistics } from "../VideoStatistics";
import { VeRtcStatistics } from "./VeRtcStatistics";

/**
 * 动态加载的 VeRTC Web SDK。
 */
type VeRtcSDK = typeof import("@volcengine/rtc");
/**
 * 创建 VeRTC 引擎使用的应用标识。
 */
export const VERTC_APP_ID = "69a177e226e9b90176a86b96";

/**
 * VeRTC 适配器的加载依赖。
 */
export interface VeRtcManagerOptions {

  /**
   * 按需加载 RTC SDK，首次初始化时调用。
   */
  loadSDK?: () => Promise<VeRtcSDK>;
}

/**
 * SDK 内部采集、房间文本信令；原生媒体轨道复用公共渲染层。
 */
export class VeRtcManager implements RtcManaging {

  /**
   * 按需加载 RTC SDK，首次初始化时调用。
   */
  private readonly loadSDK: () => Promise<VeRtcSDK>;

  /**
   * 按需加载的 RTC SDK 模块。
   */
  private sdk?: VeRtcSDK;

  /**
   * 当前 RTC 引擎实例。
   */
  private engine?: IRTCEngine;

  /**
   * 共享的初始化任务，避免并发创建引擎。
   */
  private initialization?: Promise<void>;

  /**
   * 生命周期标识，使释放后的异步结果失效。
   */
  private lifecycle = 0;

  /**
   * 摄像头采集操作标识，过滤切换或停止后的迟到结果。
   */
  private captureVersion = 0;

  /**
   * 当前摄像头视频轨。
   */
  private camera?: MediaStreamTrack;

  /**
   * 是否已启动麦克风采集。
   */
  private microphone = false;

  /**
   * 外部媒体的克隆轨；原始轨道由媒体源管理。
   */
  private externalVideo?: MediaStreamTrack;

  /**
   * 由媒体源提供、适配器持有的外部音频克隆轨。
   */
  private externalAudio?: MediaStreamTrack;

  /**
   * 当前房间使用的身份和鉴权配置。
   */
  private connection?: VeRtcRoomJoinConfiguration;

  /**
   * 是否已经完成进房。
   */
  private joined = false;

  /**
   * 当前房间操作标识，退房后旧结果不再生效。
   */
  private roomVersion = 0;

  /**
   * 退房时取消当前房间的异步等待。
   */
  private roomAbort = new AbortController();

  /**
   * 共享的凭据恢复任务。
   */
  private recovery?: Promise<void>;

  /**
   * 共享的进房任务。
   */
  private joining?: Promise<void>;

  /**
   * 是否需要在凭据更新后重新进房。
   */
  private tokenExpired = false;

  /**
   * 发布权限是否已失效。
   */
  private publishPrivilegeExpired = false;

  /**
   * 订阅权限是否已失效。
   */
  private subscribePrivilegeExpired = false;

  /**
   * 业务当前是否要求发布本地视频。
   */
  private videoRequested = false;

  /**
   * 业务当前是否要求发布本地音频。
   */
  private audioRequested = false;

  /**
   * 当前事件监听器。
   */
  private listener?: RtcEventListener;

  /**
   * 已获知发布主视频流的远端用户。
   */
  private readonly publishedVideo = new Set<string>();

  /**
   * 已获知发布音频流的远端用户。
   */
  private readonly publishedAudio = new Set<string>();

  /**
   * 业务当前要求订阅视频的远端用户。
   */
  private readonly requestedVideo = new Set<string>();

  /**
   * 业务当前要求订阅音频的远端用户。
   */
  private readonly requestedAudio = new Set<string>();

  /**
   * 各远端用户的播放音量，范围为 0–100。
   */
  private readonly audioVolumes = new Map<string, number>();

  /**
   * 按远端用户维护的音频播放器。
   */
  private readonly audioPlayers = new Map<string, HTMLAudioElement>();

  /**
   * 音频订阅操作标识，用于丢弃迟到结果。
   */
  private readonly audioSubscriptions = new Map<string, object>();

  /**
   * 按远端用户缓存的最新视频统计。
   */
  private readonly remoteStatistics = new Map<string, RemoteVideoStatistics>();

  /**
   * 本端到 RTC 云端的上行丢包率，单位为 %。
   */
  private uplinkLossPercent?: number;

  /**
   * 设置 VeRTC 模块加载方式，初始化时再创建引擎。
   */
  constructor(
    options: VeRtcManagerOptions = {}
  ) {
    this.loadSDK = options.loadSDK ?? (() => import("@volcengine/rtc"));
  }

  /**
   * 当前 VeRTC 引擎是否可用。
   */
  get isInitialized(): boolean {
    return this.engine !== undefined;
  }

  /**
   * 当前浏览器是否支持连续音量控制；移动 Safari 降级为播放或静音。
   */
  get supportsRemoteAudioVolumeControl(): boolean {
    if (typeof navigator === "undefined")
      return true;
    return !(/iPad|iPhone|iPod/.test(navigator.userAgent) ||
      (/Macintosh/.test(navigator.userAgent) && navigator.maxTouchPoints > 1));
  }

  /**
   * 按需加载 VeRTC 并创建手动播放模式的引擎，合并并发初始化请求。
   */
  async initialize(): Promise<void> {
    if (this.engine)
      return;
    if (this.initialization)
      return this.initialization;
    const version = this.lifecycle;
    const operation = (async () => {
      const sdk = await this.loadSDK();
      if (version !== this.lifecycle)
        throw this.cancelled();
      sdk.default.setLogConfig({ logLevel: "none" });
      // 禁用厂商自动播放；视频交给公共 View，音频按当前音量显式播放，避免初始漏声。
      const engine = sdk.default.createEngine(VERTC_APP_ID, { autoPlayPolicy: sdk.RTCAutoPlayPolicy.PLAY_MANUALLY });
      this.sdk = sdk;
      this.engine = engine;
      this.registerEvents(engine);
    })();
    this.initialization = operation;
    try {
      await operation;
    }
    finally {
      if (this.initialization === operation)
        this.initialization = undefined;
    }
  }

  /**
   * 销毁 VeRTC 引擎并释放适配器持有的媒体轨和播放器。
   */
  async destroy(): Promise<void> {
    this.lifecycle++;
    this.captureVersion++;
    const engine = this.engine;
    const sdk = this.sdk;
    this.clearRoom();
    this.engine = undefined;
    this.sdk = undefined;
    this.camera = undefined;
    this.microphone = false;
    engine?.removeAllListeners();
    try {
      if (engine && sdk)
        sdk.default.destroyEngine(engine);
    } finally {
      this.externalVideo?.stop();
      this.externalAudio?.stop();
      this.externalVideo = undefined;
      this.externalAudio = undefined;
    }
  }

  /**
   * 将克隆的文件音视频轨绑定到主流，不采集设备、不自动发布。
   */
  async setExternalMediaTracks(
    tracks: {
      videoTrack: MediaStreamTrack;
      audioTrack?: MediaStreamTrack
    }
  ): Promise<void> {
    const engine = this.requireEngine();
    const sdk = this.sdk!;
    if (this.camera || this.microphone || this.externalVideo) {
      throw new XmaxError(XmaxErrorCode.invalidConfiguration, "Release the current local media before attaching external tracks");
    }
    if (tracks.videoTrack.kind !== "video" || tracks.videoTrack.readyState !== "live" ||
      (tracks.audioTrack && (tracks.audioTrack.kind !== "audio" || tracks.audioTrack.readyState !== "live"))) {
      throw new XmaxError(XmaxErrorCode.invalidConfiguration, "External media tracks must be live video/audio tracks");
    }

    const video = tracks.videoTrack.clone();
    this.externalVideo = video;
    let audio: MediaStreamTrack | undefined;
    const index = sdk.StreamIndex.STREAM_INDEX_MAIN;
    const ensureCurrent = () => {
      if (this.engine !== engine || this.externalVideo !== video) {
        throw this.cancelled();
      }
    };
    try {
      audio = tracks.audioTrack?.clone();
      this.externalAudio = audio;
      await engine.setVideoSourceType(index, sdk.VideoSourceType.VIDEO_SOURCE_TYPE_EXTERNAL);
      ensureCurrent();
      await engine.setExternalVideoTrack(index, video);
      ensureCurrent();
      if (audio) {
        await engine.setAudioSourceType(index, sdk.AudioSourceType.AUDIO_SOURCE_TYPE_EXTERNAL);
        ensureCurrent();
        await engine.setExternalAudioTrack(index, audio);
        ensureCurrent();
      }
    } catch (error) {
      // 还原采集模式但不启动设备；原引擎已销毁时只释放克隆轨。
      if (this.engine === engine) {
        await engine.setAudioSourceType(index, sdk.AudioSourceType.AUDIO_SOURCE_TYPE_INTERNAL).catch(() => { });
        await engine.setVideoSourceType(index, sdk.VideoSourceType.VIDEO_SOURCE_TYPE_INTERNAL).catch(() => { });
      }
      if (this.externalVideo === video) {
        this.externalVideo = undefined;
        this.externalAudio = undefined;
      }
      video.stop();
      audio?.stop();
      throw this.mapError(error);
    }
  }

  /**
   * 启动摄像头采集，不自动发布视频；不支持非零旋转角度。
   */
  async startCameraCapture(
    options: RtcCameraCaptureOptions
  ): Promise<MediaStreamTrack> {
    if (options.rotation !== undefined && options.rotation !== 0) {
      throw new XmaxError(XmaxErrorCode.invalidConfiguration, "Camera rotation currently requires Agora");
    }
    const engine = this.requireEngine();
    if (this.camera || this.externalVideo) {
      throw new XmaxError(XmaxErrorCode.invalidConfiguration, "Local video is already prepared");
    }
    const version = ++this.captureVersion;
    await this.run(() => engine.setVideoEncoderConfig({
      ...rtcOrientedVideoSize({ width: options.width, height: options.height }), frameRate: options.frameRate, maxKbps: 1000,
      preferCodecName: this.sdk!.VideoCodecType.H264, contentHint: "motion",
    }));
    if (engine !== this.engine || version !== this.captureVersion)
      throw this.cancelled();
    try {
      await engine.startVideoCapture(options.position === CameraPosition.front ? "user" : "environment");
      if (engine !== this.engine || version !== this.captureVersion) {
        await engine.stopVideoCapture().catch(() => { });
        throw this.cancelled();
      }
      const track = engine.getLocalStreamTrack(this.sdk!.StreamIndex.STREAM_INDEX_MAIN, "video");
      if (!track) {
        await engine.stopVideoCapture();
        throw new XmaxError(XmaxErrorCode.rtcError, "VeRTC camera track is unavailable");
      }
      this.camera = track;
      return track;
    } catch (error) {
      throw this.mapError(error, XmaxErrorCode.cameraPermissionDenied);
    }
  }

  /**
   * 更新未连接的摄像头采集规格，复用引擎和当前设备。
   */
  async updateCameraCapture(
    options: RtcCameraCaptureOptions
  ): Promise<MediaStreamTrack> {
    const engine = this.requireEngine();
    this.requireCamera();
    if (this.connection) {
      throw new XmaxError(XmaxErrorCode.invalidConfiguration, "Disconnect VeRTC before updating camera capture");
    }
    const version = this.captureVersion;
    const size = rtcOrientedVideoSize(options);
    await this.run(() => engine.setVideoEncoderConfig({
      width: size.width, height: size.height, frameRate: options.frameRate, maxKbps: 1000,
      preferCodecName: this.sdk!.VideoCodecType.H264, contentHint: "motion",
    }));
    if (engine !== this.engine || version !== this.captureVersion) {
      throw this.cancelled();
    }
    const track = engine.getLocalStreamTrack(this.sdk!.StreamIndex.STREAM_INDEX_MAIN, "video");
    if (!track) {
      throw new XmaxError(XmaxErrorCode.rtcError, "VeRTC camera track is unavailable");
    }
    this.camera = track;
    return track;
  }

  /**
   * 切换前后置摄像头，返回切换后的视频轨。
   */
  async switchCameraCapture(
    to: CameraPosition
  ): Promise<MediaStreamTrack> {
    const engine = this.requireEngine();
    this.requireCamera();
    const version = this.captureVersion;
    await this.run(() => engine.setVideoCaptureDevice(to === CameraPosition.front ? "user" : "environment"));
    if (engine !== this.engine || version !== this.captureVersion)
      throw this.cancelled();
    const track = engine.getLocalStreamTrack(this.sdk!.StreamIndex.STREAM_INDEX_MAIN, "video");
    if (!track)
      throw new XmaxError(XmaxErrorCode.rtcError, "VeRTC camera track is unavailable");
    this.camera = track;
    return track;
  }

  /**
   * 停止摄像头采集并清除当前轨道引用。
   */
  async stopCameraCapture(): Promise<void> {
    if (this.externalVideo) {
      return;
    }
    this.captureVersion++;
    this.camera = undefined;
    if (this.engine)
      await this.run(() => this.engine!.stopVideoCapture());
  }

  /**
   * 将当前方向下的视频尺寸、帧率和码率约束应用到编码器。
   */
  async configureVideoEncoding(
    config: VideoEncodingConfiguration
  ): Promise<void> {
    const engine = this.requireEngine();
    this.requireLocalVideo();
    // 外部画布无需摄像头的移动端方向补偿。
    const size = this.externalVideo ? config : rtcOrientedVideoSize(config);
    await this.run(() => engine.setVideoEncoderConfig({
      width: size.width, height: size.height, frameRate: config.frameRate, maxKbps: config.maximumBitrate,
      contentHint: config.encoderPreference === RtcVideoEncoderPreference.maintainFramerate ? "motion" : "detail",
      preferCodecName: this.sdk!.VideoCodecType.H264,
    }));
  }

  /**
   * 使用当前会话凭据加入 VeRTC 房间，并合并并发进房操作。
   */
  async joinRoom(
    config: RtcRoomJoinConfiguration
  ): Promise<void> {
    await this.joining?.catch(() => { });
    await this.recovery?.catch(() => { });
    const engine = this.requireEngine();
    if (config.provider !== RtcProvider.vertc || config.appID !== VERTC_APP_ID || this.connection) {
      throw new XmaxError(XmaxErrorCode.invalidConfiguration, "VeRTC credentials for the configured AppID and an idle room are required");
    }
    this.clearRoom();
    this.connection = config;
    const version = this.roomVersion;
    const task = this.performJoin(engine, config, version);
    this.joining = task;
    try {
      await task;
    }
    finally {
      if (this.joining === task)
        this.joining = undefined;
    }
  }

  /**
   * 完成当前进房操作，取消后退出迟到创建的房间。
   */
  private async performJoin(
    engine: IRTCEngine,
    config: VeRtcRoomJoinConfiguration,
    version: number
  ): Promise<void> {
    try {
      await this.enter(engine, config);
      if (!this.isCurrent(engine, version)) {
        await engine.leaveRoom().catch(() => { });
        throw this.cancelled();
      }
      this.joined = true;
      this.replayVideo();
    } catch (error) {
      if (this.isCurrent(engine, version))
        this.clearRoom();
      throw this.mapError(error);
    }
  }

  /**
   * 调用 VeRTC 进房接口，关闭自动发布和自动订阅。
   */
  private enter(
    engine: IRTCEngine,
    config: VeRtcRoomJoinConfiguration
  ): Promise<void> {
    return this.run(() => engine.joinRoom(config.roomToken, config.roomID, { userId: config.userID }, {
      isAutoPublish: false, isAutoSubscribeAudio: false, isAutoSubscribeVideo: false,
      roomProfileType: this.sdk!.RoomProfileType.communication,
    }));
  }

  /**
   * 退出当前房间并清理订阅、播放器与统计。
   */
  async leaveRoom(): Promise<void> {
    const engine = this.engine;
    this.clearRoom();
    if (engine)
      await this.run(() => engine.leaveRoom());
  }

  /**
   * 正常续签仅 updateToken；被移出房间后重进，恢复发布与订阅意图。
   */
  async updateCredentials(
    config: RtcRoomJoinConfiguration,
    signal?: AbortSignal
  ): Promise<void> {
    const engine = this.requireEngine();
    const current = this.connection;
    if (signal?.aborted)
      throw this.cancelled();
    if (!current || config.provider !== RtcProvider.vertc || config.appID !== current.appID || config.roomID !== current.roomID || config.userID !== current.userID) {
      throw new XmaxError(XmaxErrorCode.sessionError, "VeRTC session binding changed");
    }
    const version = this.roomVersion;
    if (this.recovery)
      await this.cancellable(this.recovery, signal);
    if (!this.isCurrent(engine, version))
      throw this.cancelled();
    const task = this.renew(engine, config, version);
    this.recovery = task;
    void task.finally(() => {
      if (this.recovery === task)
        this.recovery = undefined;
    }).catch(() => { });
    await this.cancellable(task, signal);
  }

  /**
   * 更新令牌，必要时重新进房并恢复原有发布和订阅意图。
   */
  private async renew(
    engine: IRTCEngine,
    config: VeRtcRoomJoinConfiguration,
    version: number
  ): Promise<void> {
    if (!this.tokenExpired) {
      try {
        await this.run(() => engine.updateToken(config.roomToken));
      }
      catch (error) {
        this.ensureCurrent(engine, version);
        if (!this.tokenExpired)
          throw error;
      }
    }
    this.ensureCurrent(engine, version);
    const restore = this.tokenExpired || this.publishPrivilegeExpired || this.subscribePrivilegeExpired;
    if (restore) {
      this.joined = false;
      this.listener?.onRoomRejoining?.();
      this.clearPlayers();
      this.clearStatistics();
      if (this.tokenExpired) {
        this.publishedVideo.clear();
        this.publishedAudio.clear();
        await this.run(() => engine.leaveRoom());
        this.ensureCurrent(engine, version);
        await this.enter(engine, config);
        if (!this.isCurrent(engine, version)) {
          await engine.leaveRoom().catch(() => { });
          throw this.cancelled();
        }
      }
      if ((this.tokenExpired || this.publishPrivilegeExpired) && this.videoRequested && (this.camera || this.externalVideo)) {
        await this.run(() => engine.publishStream(this.sdk!.MediaType.VIDEO));
        this.ensureCurrent(engine, version);
        if (!this.videoRequested) {
          await this.run(() => engine.unpublishStream(this.sdk!.MediaType.VIDEO));
          this.ensureCurrent(engine, version);
        }
      }
      if ((this.tokenExpired || this.publishPrivilegeExpired) && this.audioRequested && (this.microphone || this.externalAudio)) {
        await this.run(() => engine.publishStream(this.sdk!.MediaType.AUDIO));
        this.ensureCurrent(engine, version);
        if (!this.audioRequested) {
          await this.run(() => engine.unpublishStream(this.sdk!.MediaType.AUDIO));
          this.ensureCurrent(engine, version);
        }
      }
    }
    this.connection = config;
    this.tokenExpired = false;
    this.publishPrivilegeExpired = false;
    this.subscribePrivilegeExpired = false;
    this.joined = true;
    if (restore) {
      this.replayVideo();
      for (const userID of this.requestedAudio) {
        if (this.publishedAudio.has(userID))
          await this.subscribeRemoteAudio(userID, true);
        this.ensureCurrent(engine, version);
      }
    }
  }

  /**
   * 发布已准备的本地视频轨。
   */
  async publishLocalVideo(): Promise<void> {
    const engine = this.requireEngine();
    this.requireLocalVideo();
    this.videoRequested = true;
    const version = this.roomVersion;
    await this.recovery;
    this.ensureCurrent(engine, version);
    if (!this.videoRequested)
      throw this.cancelled();
    await this.run(() => engine.publishStream(this.sdk!.MediaType.VIDEO));
  }

  /**
   * 停止发布视频，保留本地媒体源。
   */
  async unpublishLocalVideo(): Promise<void> {
    this.videoRequested = false;
    if (this.joined && !this.tokenExpired)
      await this.run(() => this.requireEngine().unpublishStream(this.sdk!.MediaType.VIDEO));
  }

  /**
   * 发布文件音频，或在设备采集模式下启动并发布麦克风音频。
   */
  async publishLocalAudio(): Promise<void> {
    const engine = this.requireEngine();
    if (this.externalVideo && !this.externalAudio) {
      return;
    }
    this.audioRequested = true;
    const version = this.roomVersion;
    await this.recovery;
    this.ensureCurrent(engine, version);
    try {
      if (!this.externalVideo && !this.microphone) {
        await engine.startAudioCapture();
        if (!this.isCurrent(engine, version)) {
          await engine.stopAudioCapture().catch(() => { });
          throw this.cancelled();
        }
        this.microphone = true;
      }
      if (!this.audioRequested)
        throw this.cancelled();
      await engine.publishStream(this.sdk!.MediaType.AUDIO);
    } catch (error) {
      throw this.mapError(error, this.externalVideo ? XmaxErrorCode.rtcError : XmaxErrorCode.microphonePermissionDenied);
    }
  }

  /**
   * 停止发布音频，保留已经准备的媒体资源。
   */
  async unpublishLocalAudio(): Promise<void> {
    this.audioRequested = false;
    if (this.joined && !this.tokenExpired)
      await this.run(() => this.requireEngine().unpublishStream(this.sdk!.MediaType.AUDIO));
  }

  /**
   * 更新指定用户的视频订阅，订阅成功后返回其主视频轨。
   */
  async subscribeRemoteVideo(
    userID: string,
    subscribe: boolean
  ): Promise<MediaStreamTrack | undefined> {
    const engine = this.requireEngine();
    const version = this.roomVersion;
    if (!subscribe) {
      this.requestedVideo.delete(userID);
      this.remoteStatistics.delete(userID);
      this.emitRemoteStatistics();
      if (this.joined && !this.tokenExpired)
        await this.run(() => engine.unsubscribeStream(userID, this.sdk!.MediaType.VIDEO));
      return;
    }
    this.requestedVideo.add(userID);
    await this.run(() => engine.subscribeStream(userID, this.sdk!.MediaType.VIDEO));
    this.ensureCurrent(engine, version);
    if (!this.requestedVideo.has(userID))
      return;
    const track = engine.getRemoteStreamTrack(userID, this.sdk!.StreamIndex.STREAM_INDEX_MAIN, "video");
    if (!track)
      throw new XmaxError(XmaxErrorCode.rtcError, "VeRTC remote video track is unavailable");
    return track;
  }

  /**
   * 更新指定用户的音频订阅，并按当前音量绑定播放器。
   */
  async subscribeRemoteAudio(
    userID: string,
    subscribe: boolean
  ): Promise<void> {
    const engine = this.requireEngine();
    const version = this.roomVersion;
    if (!subscribe) {
      this.requestedAudio.delete(userID);
      this.clearPlayer(userID);
      if (this.joined && !this.tokenExpired && this.publishedAudio.has(userID))
        await this.run(() => engine.unsubscribeStream(userID, this.sdk!.MediaType.AUDIO));
      return;
    }
    this.requestedAudio.add(userID);
    if (!this.joined || this.tokenExpired || !this.publishedAudio.has(userID))
      return;
    const subscription = {};
    this.audioSubscriptions.set(userID, subscription);
    await this.run(() => engine.subscribeStream(userID, this.sdk!.MediaType.AUDIO));
    if (!this.isCurrent(engine, version) || !this.joined || this.tokenExpired ||
      this.audioSubscriptions.get(userID) !== subscription ||
      !this.requestedAudio.has(userID) || !this.publishedAudio.has(userID))
      return;
    const track = engine.getRemoteStreamTrack(userID, this.sdk!.StreamIndex.STREAM_INDEX_MAIN, "audio");
    if (!track)
      return;
    this.clearPlayer(userID);
    const player = document.createElement("audio");
    player.srcObject = new MediaStream([track]);
    this.audioPlayers.set(userID, player);
    this.applyAudioVolume(userID);
  }

  /**
   * 获取原始远端音轨，独立于 audio 元素的静音和播放音量。
   */
  getRemoteAudioTrack(
    userID: string
  ): MediaStreamTrack | undefined {
    return this.requireEngine().getRemoteStreamTrack(userID, this.sdk!.StreamIndex.STREAM_INDEX_MAIN, "audio");
  }

  /**
   * 设置指定远端用户的播放音量，范围为 0–100。
   */
  setRemoteAudioVolume(
    volume: number,
    userID: string
  ): void {
    this.audioVolumes.set(userID, Number.isFinite(volume) ? Math.max(0, Math.min(100, Math.round(volume))) : 0);
    this.applyAudioVolume(userID);
  }

  /**
   * 将当前音量应用到远端播放器；不支持连续音量时切换播放或静音。
   */
  private applyAudioVolume(
    userID: string
  ): void {
    const player = this.audioPlayers.get(userID);
    if (!player)
      return;
    const volume = this.audioVolumes.get(userID) ?? 0;
    player.muted = volume === 0 || !this.requestedAudio.has(userID);
    if (this.supportsRemoteAudioVolumeControl)
      player.volume = volume / 100;
    if (player.muted)
      player.pause();
    else
      void player.play().catch(() => {
        XmaxLogger.rtc.warning(() => "VeRTC audio playback requires a user interaction");
      });
  }

  /**
   * 在当前房间发送文本消息，校验字节数并限制等待时长。
   */
  async sendRoomMessage(
    message: string
  ): Promise<void> {
    const engine = this.requireEngine();
    const version = this.roomVersion;
    if (!this.joined || this.tokenExpired)
      throw this.cancelled();
    if (new TextEncoder().encode(message).byteLength > 64 * 1024) {
      throw new XmaxError(XmaxErrorCode.invalidConfiguration, "VeRTC room message exceeds the 64-KiB limit");
    }
    // 不添加包装、不拆包；保留公共 RoomEvent 原始 JSON。
    await this.cancellable(this.run(async () => {
      const sent = engine.sendRoomMessage(message);
      if (!sent)
        throw new XmaxError(XmaxErrorCode.rtcError, "VeRTC room message was not sent");
      await sent;
    }), undefined, 5000);
    this.ensureCurrent(engine, version);
  }

  /**
   * 替换 RTC 事件监听器。
   */
  setEventListener(
    listener?: RtcEventListener
  ): void {
    this.listener = listener;
  }

  /**
   * 将 VeRTC 事件转换为公共发布、订阅和统计通知。
   */
  private registerEvents(
    engine: IRTCEngine
  ): void {
    const events = this.sdk!.default.events;
    const active = () => engine === this.engine && this.connection !== undefined;
    const mediaActive = () => active() && this.joined && !this.tokenExpired;
    const video = (mediaType: number) => (mediaType & this.sdk!.MediaType.VIDEO) !== 0;
    const audio = (mediaType: number) => (mediaType & this.sdk!.MediaType.AUDIO) !== 0;
    engine.on(events.onUserPublishStream, ({ userId, mediaType }) => {
      if (!active())
        return;
      if (video(mediaType)) {
        this.publishedVideo.add(userId);
        if (mediaActive())
          this.listener?.onRemoteVideoPublished(userId, true);
      }
      if (audio(mediaType)) {
        this.publishedAudio.add(userId);
        if (mediaActive() && this.requestedAudio.has(userId)) {
          void this.subscribeRemoteAudio(userId, true).catch(error => {
            if (mediaActive())
              this.listener?.onError?.(this.mapError(error));
          });
        }
      }
    });
    engine.on(events.onUserUnpublishStream, ({ userId, mediaType }) => {
      if (!active())
        return;
      if (video(mediaType))
        this.removeVideo(userId);
      if (audio(mediaType)) {
        this.publishedAudio.delete(userId);
        this.clearPlayer(userId);
      }
    });
    engine.on(events.onUserLeave, ({ userInfo }) => {
      if (!active())
        return;
      this.removeVideo(userInfo.userId);
      this.publishedAudio.delete(userInfo.userId);
      this.clearPlayer(userInfo.userId);
    });
    engine.on(events.onRoomMessageReceived, ({ userId, message }) => {
      if (mediaActive() && typeof message === "string")
        this.listener?.onCustomMessageReceived(userId, message);
    });
    const willExpire = () => {
      if (active())
        this.listener?.onTokenWillExpire?.();
    };
    engine.on(events.onTokenWillExpire, willExpire);
    engine.on(events.onTokenPublishPrivilegeWillExpire, willExpire);
    engine.on(events.onTokenSubscribePrivilegeWillExpire, willExpire);
    engine.on(events.onTokenPublishPrivilegeDidExpired, () => {
      if (!active() || this.publishPrivilegeExpired)
        return;
      this.publishPrivilegeExpired = true;
      this.listener?.onTokenExpired?.();
    });
    engine.on(events.onTokenSubscribePrivilegeDidExpired, () => {
      if (!active() || this.subscribePrivilegeExpired)
        return;
      this.subscribePrivilegeExpired = true;
      this.clearPlayers();
      this.listener?.onTokenExpired?.();
    });
    engine.on(events.onError, ({ errorCode }) => {
      if (!active())
        return;
      if (errorCode === "TOKEN_EXPIRED") {
        if (this.tokenExpired)
          return;
        this.tokenExpired = true;
        this.clearPlayers();
        this.listener?.onTokenExpired?.();
      } else
        this.listener?.onError?.(this.mapError({ code: errorCode }));
    });
    // 网络断线由厂商自动恢复，避免自行重复 join。恢复后重新绑定可能替换的轨道。
    engine.on(events.onConnectionStateChanged, ({ state }) => {
      if (!mediaActive() || state !== this.sdk!.ConnectionState.CONNECTION_STATE_RECONNECTED)
        return;
      this.listener?.onRoomRejoining?.();
      this.clearPlayers();
      this.clearStatistics();
      this.replayVideo();
      for (const userID of this.requestedAudio) {
        void this.subscribeRemoteAudio(userID, true).catch(error => {
          if (mediaActive())
            this.listener?.onError?.(this.mapError(error));
        });
      }
    });
    engine.on(events.onNetworkQuality, (up, down) => {
      if (mediaActive())
        this.listener?.onNetworkStatistics?.(Object.freeze({
          uplinkQuality: VeRtcStatistics.quality(up), downlinkQuality: VeRtcStatistics.quality(down),
        }));
    });
    engine.on(events.onLocalStreamStats, stats => {
      if (!mediaActive() || stats.isScreen || !this.videoRequested)
        return;
      const result = VeRtcStatistics.local(stats.videoStats);
      this.uplinkLossPercent = result.uplinkLossPercent;
      this.listener?.onLocalVideoStatistics?.(result);
      XmaxLogger.rtc.info(() => `VeRTC local video statistics: ${JSON.stringify(result)}`, XmaxLoggerOption.performance);
    });
    engine.on(events.onRemoteStreamStats, stats => {
      if (!mediaActive() || stats.isScreen || !this.requestedVideo.has(stats.userId))
        return;
      this.remoteStatistics.set(stats.userId, VeRtcStatistics.remote(stats.userId, stats.videoStats, this.uplinkLossPercent));
      this.emitRemoteStatistics();
    });
  }

  /**
   * 向监听器重新报告已知的远端视频发布状态。
   */
  private replayVideo(): void {
    for (const userID of this.publishedVideo) this.listener?.onRemoteVideoPublished(userID, true);
  }

  /**
   * 移除远端用户的视频发布记录并清除其统计。
   */
  private removeVideo(
    userID: string
  ): void {
    this.publishedVideo.delete(userID);
    this.remoteStatistics.delete(userID);
    this.emitRemoteStatistics();
    if (this.joined && !this.tokenExpired)
      this.listener?.onRemoteVideoPublished(userID, false);
  }

  /**
   * 交付当前远端视频统计的只读快照。
   */
  private emitRemoteStatistics(): void {
    this.listener?.onRemoteVideoStatistics?.(Object.freeze([...this.remoteStatistics.values()]));
  }

  /**
   * 清除视频统计并通知当前没有可用样本。
   */
  private clearStatistics(): void {
    this.remoteStatistics.clear();
    this.uplinkLossPercent = undefined;
    this.listener?.onLocalVideoStatistics?.(undefined);
    this.emitRemoteStatistics();
  }

  /**
   * 释放指定远端用户的音频播放器。
   */
  private clearPlayer(
    userID: string
  ): void {
    this.audioSubscriptions.delete(userID);
    const player = this.audioPlayers.get(userID);
    if (player) {
      player.pause();
      player.srcObject = null;
    }
    this.audioPlayers.delete(userID);
  }

  /**
   * 释放全部远端音频播放器和订阅标识。
   */
  private clearPlayers(): void {
    this.audioSubscriptions.clear();
    for (const userID of this.audioPlayers.keys()) this.clearPlayer(userID);
  }

  /**
   * 使当前房间操作失效并清理鉴权、媒体意图和订阅缓存。
   */
  private clearRoom(): void {
    this.roomVersion++;
    this.roomAbort.abort();
    this.roomAbort = new AbortController();
    this.connection = undefined;
    this.joined = false;
    this.tokenExpired = false;
    this.publishPrivilegeExpired = false;
    this.subscribePrivilegeExpired = false;
    this.videoRequested = false;
    this.audioRequested = false;
    this.publishedVideo.clear();
    this.publishedAudio.clear();
    this.requestedVideo.clear();
    this.requestedAudio.clear();
    this.audioVolumes.clear();
    this.clearPlayers();
    this.clearStatistics();
  }

  /**
   * 业务取消立即结束等待；底层迟到结果由版本检查清理。
   */
  private async cancellable<T>(
    task: Promise<T>,
    signal?: AbortSignal,
    timeoutMs?: number
  ): Promise<T> {
    const roomSignal = this.roomAbort.signal;
    return new Promise<T>((resolve, reject) => {
      const timer = timeoutMs === undefined ? undefined : setTimeout(() => {
        cleanup();
        reject(new XmaxError(XmaxErrorCode.timeout, "VeRTC room message send timed out"));
      }, timeoutMs);
      const cleanup = () => {
        clearTimeout(timer);
        roomSignal.removeEventListener("abort", cancel);
        signal?.removeEventListener("abort", cancel);
      };
      const cancel = () => {
        // 外部取消使续签后续步骤失效，但由正常退房流程释放所有资源。
        if (signal?.aborted && !roomSignal.aborted)
          this.roomVersion++;
        cleanup();
        reject(this.cancelled());
      };
      roomSignal.addEventListener("abort", cancel, { once: true });
      signal?.addEventListener("abort", cancel, { once: true });
      task.then(value => {
        cleanup();
        resolve(value);
      }, error => {
        cleanup();
        reject(error);
      });
      if (roomSignal.aborted || signal?.aborted)
        cancel();
    });
  }

  /**
   * 检查引擎、房间和操作版本是否仍然有效。
   */
  private isCurrent(
    engine: IRTCEngine,
    version: number
  ): boolean {
    return this.engine === engine && this.connection !== undefined && this.roomVersion === version;
  }

  /**
   * 当前房间操作已失效时抛出取消错误。
   */
  private ensureCurrent(
    engine: IRTCEngine,
    version: number
  ): void {
    if (!this.isCurrent(engine, version))
      throw this.cancelled();
  }

  /**
   * 获取已初始化引擎，尚未初始化时抛出 RTC 错误。
   */
  private requireEngine(): IRTCEngine {
    if (!this.engine)
      throw new XmaxError(XmaxErrorCode.rtcError, "VeRTC is not initialized");
    return this.engine;
  }

  /**
   * 获取已准备的文件或摄像头视频轨。
   */
  private requireLocalVideo(): MediaStreamTrack {
    if (this.externalVideo) {
      return this.externalVideo;
    }
    return this.requireCamera();
  }

  /**
   * 获取正在采集的摄像头轨，未采集时抛出配置错误。
   */
  private requireCamera(): MediaStreamTrack {
    if (!this.camera)
      throw new XmaxError(XmaxErrorCode.invalidConfiguration, "Camera capture is not running");
    return this.camera;
  }

  /**
   * 执行 VeRTC 异步操作并统一转换厂商错误。
   */
  private async run<T>(
    operation: () => Promise<T>
  ): Promise<T> {
    try {
      return await operation();
    } catch (error) {
      throw this.mapError(error);
    }
  }

  /**
   * 转换厂商错误，按需要区分设备权限和 RTC 失败。
   */
  private mapError(
    error: unknown,
    permissionCode?: XmaxErrorCode
  ): XmaxError {
    if (error instanceof XmaxError)
      return error;
    const value = error as {
      code?: unknown;
      name?: unknown
    } | null;
    const code = typeof value?.code === "string" && /^[A-Z_0-9-]{1,64}$/.test(value.code) ? value.code : "UNKNOWN";
    const denied = value?.name === "NotAllowedError" || code === "PERMISSION_DENIED" || code === "DEVICE_PERMISSION_DENIED";
    return new XmaxError(permissionCode && denied ? permissionCode : XmaxErrorCode.rtcError, `VeRTC operation failed (${code})`);
  }

  /**
   * 构造当前 RTC 操作已取消的业务错误。
   */
  private cancelled(): XmaxError {
    return new XmaxError(XmaxErrorCode.cancelled, "VeRTC operation was cancelled");
  }
}
