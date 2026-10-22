//
//  ExternalVideoController.ts
//  XmaxSDK
//
//  Author: 翁跃庭 (Yueting Weng)
//  GitHub: https://github.com/Xmax-AI/XmaxSDK-Web
//
//  Copyright (c) 2026 XMAX.AI PTE. LTD.
//

import { XmaxError, XmaxErrorCode } from "../../Foundation/Errors/XmaxError";
import type { MediaServicing } from "../../Service/Media/MediaServicing";
import { RealtimeMediaStream } from "../../Service/Realtime/RealtimeMediaStream";
import type { RealtimeVideoFormat } from "../../Service/Realtime/RealtimeVideoFormat";
import { RealtimeVideoTrack } from "../../Service/Realtime/RealtimeVideoTrack";
import { StreamID } from "../../Service/Realtime/StreamID";

/**
 * 仅持有外部视频轨的副本；不采集设备、不处理画面、不创建预览。
 */
export class ExternalVideoController {

  /**
   * 当前媒体源对应的 SDK 视频轨道。
   */
  private track?: RealtimeVideoTrack;

  /**
   * 媒体源结束时释放资源并通知上层。
   */
  private readonly onEnded = () => {
    this.onError(new XmaxError(XmaxErrorCode.mediaError, "External video source ended"));
  };

  /**
   * 设置外部视频轨结束时的错误通知。
   */
  constructor(
    private readonly onError: (
      error: XmaxError
    ) => void
  ) { }

  /**
   * 当前由 SDK 持有的外部视频克隆轨。
   */
  get currentTrack(): RealtimeVideoTrack | undefined {
    return this.track;
  }

  /**
   * 校验并克隆外部视频轨，按统一媒体规则解析上行基准，不修改原始轨道像素。
   *
   * @param options 外部 live 视频轨及原始媒体规格。
   * @param mediaService 当前模型的媒体尺寸解析服务。
   * @returns 持有轨道副本和解析后固定媒体规格的本地流。
   */
  create(
    options: {
      videoTrack: MediaStreamTrack;
      videoFormat: RealtimeVideoFormat
    },
    mediaService: MediaServicing
  ): RealtimeMediaStream {
    if (this.track)
      throw new XmaxError(XmaxErrorCode.invalidConfiguration, "Close the current external video first");
    const { videoTrack, videoFormat } = options;
    if (!videoTrack || videoTrack.kind !== "video" || videoTrack.readyState !== "live" || typeof videoTrack.clone !== "function") {
      throw new XmaxError(XmaxErrorCode.invalidConfiguration, "External video requires a live video MediaStreamTrack");
    }
    const size = mediaService.resolveMediaSize(videoFormat, "external");
    const format = videoFormat.resized(size.width, size.height);
    format.validate();
    const nativeTrack = videoTrack.clone();
    if (nativeTrack.readyState !== "live") {
      nativeTrack.stop();
      throw new XmaxError(XmaxErrorCode.mediaError, "External video source ended during setup");
    }
    const track = new RealtimeVideoTrack({ id: "external-video", videoFormat: format });
    track.mediaStreamTrack = nativeTrack;
    nativeTrack.addEventListener("ended", this.onEnded);
    this.track = track;
    return new RealtimeMediaStream({ id: StreamID.local, videoTrack: track });
  }

  /**
   * 解除结束事件监听并释放 SDK 持有的克隆轨。
   */
  stop(): void {
    const nativeTrack = this.track?.mediaStreamTrack;
    this.track = undefined;
    nativeTrack?.removeEventListener("ended", this.onEnded);
    nativeTrack?.stop();
  }
}
