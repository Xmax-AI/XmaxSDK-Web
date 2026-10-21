//
//  NonRealtimeTask.ts
//  XmaxSDK
//
//  Author: 翁跃庭 (Yueting Weng)
//  GitHub: https://github.com/Xmax-AI/XmaxSDK-Web
//
//  Copyright (c) 2026 XMAX.AI PTE. LTD.
//

/**
 * 非实时视频的输出质量。
 */
export enum NonRealtimeQuality {

  /**
   * 标准清晰度输出。
   */
  sd = "sd",

  /**
   * 高清输出。
   */
  hd = "hd",
}

/**
 * 服务端任务状态；上传进度不属于任务状态。
 */
export enum NonRealtimeTaskStatus {

  /**
   * 任务已提交，等待服务端处理。
   */
  submitted = "submitted",

  /**
   * 服务端正在处理任务。
   */
  processing = "processing",

  /**
   * 任务处理完成。
   */
  completed = "completed",

  /**
   * 任务处理失败。
   */
  error = "error",
}

/**
 * 提交非实时任务的参数；资源必须来自 Xmax 上传流程，不能使用 blob URL 或本地路径。
 */
export interface NonRealtimeTaskOptions {

  /**
   * 模型标识。
   */
  model: string;

  /**
   * 已上传源视频的 URL。
   */
  videoPath: string;

  /**
   * 生成指令；去除首尾空白后为 1–1024 个字符。
   */
  prompt: string;

  /**
   * 已上传参考图片的 URL；省略表示不使用参考图。
   */
  referencePath?: string;

  /**
   * 输出质量。
   */
  quality: NonRealtimeQuality;

  /**
   * 可选的处理帧率；仅接受协议支持的整数，省略时沿用源视频帧率（含小数）。
   */
  fps?: number;
}

/**
 * 非实时生成结果；缺失或 null 的服务端字段规范化为 undefined。
 */
export interface NonRealtimeResult {

  /**
   * 生成结果文件的访问 URL。
   */
  readonly url?: string;

  /**
   * 服务端上传生成结果时返回的错误说明。
   */
  readonly uploadError?: string;

  /**
   * 生成结果的上传状态。
   */
  readonly uploadStatus?: string;

  /**
   * 服务端结果收尾耗时，单位为毫秒。
   */
  readonly finalizeDurationMs?: number;

  /**
   * 服务端使用的压缩等级。
   */
  readonly compressionLevel?: string;

  /**
   * 结果视频的帧数。
   */
  readonly frameCount?: number;

  /**
   * 结果视频帧率，单位为 fps。
   */
  readonly fps?: number;

  /**
   * 结果视频时长，单位为毫秒。
   */
  readonly durationMs?: number;

  /**
   * 结果文件大小，单位为字节。
   */
  readonly fileSizeBytes?: number;

  /**
   * 服务端处理时丢弃的帧数。
   */
  readonly droppedFrameCount?: number;

  /**
   * 结果压缩前的文件大小，单位为字节。
   */
  readonly originalFileSizeBytes?: number;
}

/**
 * 非实时任务快照；uid 和 status 为 SDK 查询、恢复及轮询所需字段。
 * 时间戳保持服务端原始字符串，不推断时区。
 */
export interface NonRealtimeTask {

  /**
   * 非实时任务标识，用于查询和恢复任务。
   */
  readonly uid: string;

  /**
   * 服务端返回的运行状态。
   */
  readonly status: NonRealtimeTaskStatus;

  /**
   * 业务用户标识。
   */
  readonly userUid?: string;

  /**
   * 本次视频生成使用的文字指令。
   */
  readonly prompt?: string;

  /**
   * 已上传源视频的 URL。
   */
  readonly videoPath?: string;

  /**
   * 已上传参考图片的 URL。
   */
  readonly referencePath?: string;

  /**
   * 服务端任务处理器标识。
   */
  readonly processorId?: string;

  /**
   * 生成结果使用的输出质量。
   */
  readonly quality?: NonRealtimeQuality;

  /**
   * 提交任务时指定的处理帧率，单位为 fps。
   */
  readonly requestedFps?: number;

  /**
   * 服务端最终使用的处理帧率，单位为 fps。
   */
  readonly resolvedFps?: number;

  /**
   * 服务端已执行的重试次数。
   */
  readonly retryCount?: number;

  /**
   * 源视频时长，单位为秒。
   */
  readonly videoDurationSeconds?: number;

  /**
   * 服务端报告的计费时长，单位为秒。
   */
  readonly billableDurationSeconds?: number;

  /**
   * 服务端报告的任务消耗点数。
   */
  readonly chargePoints?: number;

  /**
   * 生成结果的文件和处理信息。
   */
  readonly result?: NonRealtimeResult;

  /**
   * 服务端开始处理任务的时间。
   */
  readonly processStartTime?: string;

  /**
   * 任务创建时间。
   */
  readonly createTimestamp?: string;

  /**
   * 任务最近更新时间。
   */
  readonly updateTimestamp?: string;
}

/**
 * 分页查询选项。
 */
export interface NonRealtimeTaskListOptions {

  /**
   * 从 1 开始的页码，默认 1。
   */
  pageNumber?: number;

  /**
   * 每页数量，1–100，默认 10。
   */
  pageSize?: number;

  /**
   * 可选的任务状态筛选。
   */
  status?: NonRealtimeTaskStatus;
}

/**
 * 按创建时间从新到旧排列的任务页。
 */
export interface NonRealtimeTaskPage {

  /**
   * 当前页码，从 1 开始。
   */
  readonly pageNumber: number;

  /**
   * 当前页的容量。
   */
  readonly pageSize: number;

  /**
   * 符合查询条件的任务总数。
   */
  readonly total: number;

  /**
   * 当前页中的任务，按创建时间从新到旧排列。
   */
  readonly list: readonly NonRealtimeTask[];
}
