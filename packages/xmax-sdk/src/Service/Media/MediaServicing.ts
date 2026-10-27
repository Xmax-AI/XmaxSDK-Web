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
   *
   * @param sourceMediaSize 原始媒体尺寸。
   * @param source 媒体来源，文件媒体和外部轨道接受任意比例。
   * @returns 用于固定媒体基准和初始上行编码的尺寸。
   */
  resolveMediaSize(
    sourceMediaSize: ModelSize,
    source: "camera" | "image" | "video" | "external"
  ): ModelSize;

  /**
   * 为处理后的媒体选择模型生成画布，不改变本地媒体规格。
   */
  resolveGenerationSize(
    resolvedMediaSize: ModelSize
  ): ModelSize;

  /**
   * 根据固定媒体基准和下行尺寸上限计算 4 对齐回传尺寸。
   */
  resolveTargetSize(
    resolvedMediaSize: ModelSize,
    maximumSize: ModelSize
  ): ModelSize;

  /**
   * 解析模型支持的采集规格或生成画布，不处理媒体像素。
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
