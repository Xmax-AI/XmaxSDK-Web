//
//  RealtimeModel.ts
//  XmaxSDK
//
//  Author: 翁跃庭 (Yueting Weng)
//  GitHub: https://github.com/Xmax-AI/XmaxSDK-Web
//
//  Copyright (c) 2026 XMAX.AI PTE. LTD.
//

import { RealtimeVideoFormat } from "./RealtimeVideoFormat";
import { RtcProvider } from "../../Foundation/RTC/RtcProvider";
import { XmaxError, XmaxErrorCode } from "../../Foundation/Errors/XmaxError";

/**
 * SDK 当前支持的实时生成模型。
 */
export enum RealtimeModel {

  /**
   * 使用 VeRTC 的 X2.0 实时生成模型。
   */
  x2_0 = "x2.0",

  /**
   * 使用 Agora 的 X2.1 实时生成模型。
   */
  x2_1 = "x2.1",
}

/**
 * 内置模型或服务端新增的模型标识；自定义名称原样传给服务端。
 */
export type RealtimeModelName = RealtimeModel | (string & {});

/**
 * 校验模型名称非空，并判断是否为 SDK 内置模型。
 */
function isKnownModel(
  model: RealtimeModelName
): model is RealtimeModel {
  if (typeof model !== "string" || !model.trim()) {
    throw new XmaxError(XmaxErrorCode.invalidConfiguration, "Realtime model must be a non-empty string");
  }
  return Object.values(RealtimeModel).includes(model as RealtimeModel);
}

/**
 * 只解析本地默认配置，不替换请求中的模型标识；避免原型属性参与查表。
 */
function modelDefaults(
  model: RealtimeModelName
): RealtimeModel {
  return isKnownModel(model) ? model : RealtimeModel.x2_1;
}

/**
 * 模型在界面中展示的名称，与接口使用的模型标识分开维护。
 */
const MODEL_DISPLAY_NAMES: Readonly<Record<RealtimeModel, string>> = {
  [RealtimeModel.x2_0]: "X2.0",
  [RealtimeModel.x2_1]: "X2.1",
};

/**
 * 模型输入画面的像素尺寸。
 */
export interface ModelSize {

  /**
   * 视频宽度，单位为像素。
   */
  width: number;

  /**
   * 视频高度，单位为像素。
   */
  height: number;
}

/**
 * 各模型支持的输入分辨率桶；空数组表示按像素面积上下限和对齐规则计算尺寸。
 */
const RESOLUTION_BUCKETS: Record<RealtimeModel, ModelSize[]> = {
  [RealtimeModel.x2_0]: [],
  [RealtimeModel.x2_1]: [
    { width: 1920, height: 1080 },
    { width: 1080, height: 1920 },
    { width: 1408, height: 1408 },
    { width: 1152, height: 1536 },
    { width: 1536, height: 1152 },
  ],
};

/**
 * 本地媒体帧的最大像素面积；无固定桶时也用于限制生成画布。
 */
const MAXIMUM_INPUT_PIXELS: Record<RealtimeModel, number> = {
  [RealtimeModel.x2_0]: 1280000,
  [RealtimeModel.x2_1]: 2100000,
};

/**
 * 获取模型的显示名称。
 */
export function modelDisplayName(
  model: RealtimeModelName
): string {
  return isKnownModel(model) ? MODEL_DISPLAY_NAMES[model] : model;
}

/**
 * 模型专用的会话 API Base URL；未知模型使用测试环境地址。
 * 已知模型返回 undefined，由客户端按环境选择实时会话地址。
 */
export function modelBaseURL(
  model: RealtimeModelName
): string | undefined {
  return isKnownModel(model) ? undefined : "https://dev.22duck.cn/open/api/v1";
}

/**
 * 模型支持的固定视频规格；空列表表示按像素预算解析，帧率为推荐默认值。
 */
export function supportedVideoFormats(
  model: RealtimeModelName
): RealtimeVideoFormat[] {
  return resolutionBuckets(model).map(size => new RealtimeVideoFormat({ ...size, fps: defaultFrameRate(model) }));
}

/**
 * 模型支持的输入分辨率桶；空数组表示按像素面积上下限和对齐规则计算输入尺寸。
 */
export function resolutionBuckets(
  model: RealtimeModelName
): ModelSize[] {
  return RESOLUTION_BUCKETS[modelDefaults(model)];
}

/**
 * 输入分辨率的最小总像素面积；仅在分辨率桶为空时参与尺寸计算。
 */
export function minimumInputPixels(
  _model: RealtimeModelName
): number {
  return 600000;
}

/**
 * 输入分辨率的最大总像素面积；仅在分辨率桶为空时参与尺寸计算。
 */
export function maximumInputPixels(
  model: RealtimeModelName
): number {
  return MAXIMUM_INPUT_PIXELS[modelDefaults(model)];
}

/**
 * 输入宽度和高度分别需要对齐的像素倍数；仅在分辨率桶为空时参与尺寸计算。
 */
export function inputSizeAlignment(
  _model: RealtimeModelName
): number {
  return 32;
}

/**
 * 未指定视频规格时，各媒体来源使用的默认帧率。
 */
export function defaultFrameRate(
  _model: RealtimeModelName
): number {
  return 30;
}

/**
 * 摄像头采集使用的默认视频规格。
 */
export function defaultCameraVideoFormat(
  model: RealtimeModelName
): RealtimeVideoFormat {
  const size = modelDefaults(model) === RealtimeModel.x2_0
    ? { width: 832, height: 1472 }
    : { width: 1080, height: 1920 };
  return new RealtimeVideoFormat({ ...size, fps: defaultFrameRate(model) });
}

/**
 * 模型支持的 RTC 提供方；第一项为默认值，只读列表防止接入方修改全局能力定义。
 */
const MODEL_RTC_PROVIDERS: Readonly<Record<RealtimeModel, readonly RtcProvider[]>> = {
  [RealtimeModel.x2_0]: Object.freeze([RtcProvider.vertc]),
  [RealtimeModel.x2_1]: Object.freeze([RtcProvider.agora]),
};

/**
 * 查询 SDK 允许配置的 RTC 提供方，第一项为默认值。
 * 未知模型默认使用 Agora，也允许显式选择其他已接入的 RTC；
 * 是否被该模型的服务端支持，由服务端决定。
 */
export function supportedRtcProviders(
  model: RealtimeModelName
): readonly RtcProvider[] {
  return isKnownModel(model) ? MODEL_RTC_PROVIDERS[model] : CUSTOM_MODEL_RTC_PROVIDERS;
}

/**
 * 自定义模型允许选择的 RTC 类型，首项为默认值。
 */
const CUSTOM_MODEL_RTC_PROVIDERS: readonly RtcProvider[] = Object.freeze([
  ...MODEL_RTC_PROVIDERS[RealtimeModel.x2_1],
  ...Object.values(RtcProvider).filter((provider) =>
    !MODEL_RTC_PROVIDERS[RealtimeModel.x2_1].includes(provider)),
]);
