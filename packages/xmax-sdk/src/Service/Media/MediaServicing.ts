//
//  MediaServicing.ts
//  XmaxSDK
//
//  Author: 翁跃庭 (Yueting Weng)
//  GitHub: https://github.com/Xmax-AI/XmaxSDK-Web
//
//  Copyright (c) 2026 XMAX.AI PTE. LTD.
//

import type { ModelSize, RealtimeModelName } from "../Realtime/RealtimeModel";

/**
 * 定义媒体输入规则与平台媒体能力查询能力。
 */
export interface MediaServicing {

  /**
   * 当前媒体规则使用的模型。
   */
  readonly model: RealtimeModelName;

  /**
   * 解析原始媒体尺寸，不放大、限制像素面积并按 4 对齐；仅摄像头校验模型桶。
   */
  resolveMediaSize(
    sourceMediaSize: ModelSize,
    source: "camera" | "image" | "video"
  ): ModelSize;

  /**
   * 为处理后的媒体选择模型生成画布，不改变本地媒体规格。
   */
  resolveGenerationSize(
    resolvedMediaSize: ModelSize
  ): ModelSize;

  /**
   * 根据固定媒体基准和下行尺寸上限计算 4 对齐回传尺寸；Web 不附加插帧像素上限。
   */
  resolveTargetSize(
    resolvedMediaSize: ModelSize,
    maximumSize: ModelSize
  ): ModelSize;

  /**
   * 校验并保留原始尺寸；Web 插帧不降低回传分辨率。
   */
  resolveFrameInterpolationSize(
    size: ModelSize
  ): ModelSize;

  /**
   * 异步判断平台是否支持指定尺寸的插帧；不代表运行期性能保证。
   */
  supportsFrameInterpolation(
    size: ModelSize
  ): Promise<boolean>;

  /**
   * 保留网络视频与外部轨道的原有模型尺寸规则。
   *
   * 分辨率桶非空时必须精确匹配；否则按像素面积上下限等比缩放并对齐到
   * 模型要求的像素倍数。
   *
   * @throws 尺寸无效或不满足模型约束时抛出错误。
   */
  resolveModelInputSize(
    size: ModelSize
  ): ModelSize;
}
