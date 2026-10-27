//
//  RenderController.ts
//  XmaxSDK
//
//  Author: 翁跃庭 (Yueting Weng)
//  GitHub: https://github.com/Xmax-AI/XmaxSDK-Web
//
//  Copyright (c) 2026 XMAX.AI PTE. LTD.
//

import type { InteractionFrame } from "../Media/Interaction/InteractionFrame";
import type { RealtimeVideoTrack } from "../Service/Realtime/RealtimeVideoTrack";
import type { RealtimeVideoFormat } from "../Service/Realtime/RealtimeVideoFormat";
import { VideoRenderRegistry, type VideoRenderTarget } from "../Service/Realtime/VideoRenderBinding";
import type { RenderControlling } from "./RenderControlling";
import { TrajectoryBinding } from "./Trajectory/TrajectoryBinding";
import { TrajectoryRegistry } from "./Trajectory/TrajectoryRegistry";

/**
 * 统一管理远端轨道的画面、展示就绪状态与交互绑定，不管理生成任务。
 */
export class RenderController implements RenderControlling {

  /**
   * 当前轨道与唯一渲染目标
   */
  private track?: RealtimeVideoTrack;

  /**
   * 当前远端轨道的渲染绑定目标。
   */
  private target?: VideoRenderTarget;

  /**
   * 当前生成任务是否允许轨迹交互。
   */
  private interactionEnabled = false;

  /**
   * 当前远端视图是否已完成渲染预热。
   */
  private ready = false;

  /**
   * 注入显示生命周期通知，不持有 Core 对象。
   */
  constructor(
    private readonly callbacks: {
      onFrameDisplayed?: () => void;
      onRenderWarmupCompleted?: () => void;
    } = {}
  ) { }

  /**
   * 当前远端视图是否已完成渲染预热。
   */
  get isReady(): boolean {
    return this.ready;
  }

  /**
   * 新任务重新等待首帧和预热，避免复用上一次任务的展示就绪状态。
   */
  prepareForGeneration(): void {
    this.ready = false;
    this.target?.prepareForGeneration?.();
  }

  /**
   * 注册新轨道并使旧绑定失效；本地轨道不经过该入口。
   */
  registerRemoteTrack(
    track: RealtimeVideoTrack,
    listener: (
      frame: InteractionFrame
    ) => void
  ): void {
    this.resetRemoteTrack();
    this.track = track;
    if (track.videoFormat) {
      TrajectoryRegistry.register(track, new TrajectoryBinding(listener, track.videoFormat));
    }

    VideoRenderRegistry.register(track, {
      // 首帧后继续播放 750 ms 完成渲染预热，再开始渐入。
      renderWarmupMs: 750,
      renderWarmupCompletedHandler: () => {
        if (this.track === track) {
          this.ready = true;
          this.callbacks.onRenderWarmupCompleted?.();
        }
      },
      frameDisplayHandler: () => {
        if (this.track === track) {
          this.callbacks.onFrameDisplayed?.();
        }
      },
      attachHandler: view => {
        if (this.track !== track) {
          return;
        }
        this.ready = false;
        // 生成结果不再次镜像；显示镜像仍可由视图的公开属性设置。
        view.isMirrored = false;
        this.target = view;
        view.setMediaStream(track.mediaStreamTrack ? new MediaStream([track.mediaStreamTrack]) : null);
      },
      detachHandler: view => {
        if (this.target === view) {
          this.ready = false;
          this.target = undefined;
        }
        view.setMediaStream(null);
      },
    });
  }

  /**
   * 更新媒体画面；暂停显示时同时禁用交互。
   */
  setRemoteMedia(
    track: MediaStreamTrack | null
  ): void {
    this.ready = false;
    if (this.track) {
      TrajectoryRegistry.binding(this.track)?.update(!!track && this.interactionEnabled);
    }
    this.target?.setMediaStream(track ? new MediaStream([track]) : null);
  }

  /**
   * 更新交互绑定的输入格式和可用性。
   */
  setInteractionEnabled(
    enabled: boolean,
    format?: RealtimeVideoFormat
  ): void {
    this.interactionEnabled = enabled;
    if (this.track) {
      TrajectoryRegistry.binding(this.track)?.update(enabled, format);
    }
  }

  /**
   * 先使能力失效再清空画面，迟到首帧和旧手势不能恢复已结束任务。
   */
  resetRemoteTrack(): void {
    this.ready = false;
    const track = this.track;
    this.track = undefined;
    this.interactionEnabled = false;
    if (track) {
      TrajectoryRegistry.unregister(track);
      VideoRenderRegistry.unregister(track);
    }
    this.target?.setMediaStream(null);
    this.target = undefined;
  }
}
