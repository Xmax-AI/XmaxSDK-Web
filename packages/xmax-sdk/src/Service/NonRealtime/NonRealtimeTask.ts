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
 * The output quality for non-realtime video.
 */
export enum NonRealtimeQuality {

  /**
   * Standard-definition output.
   */
  sd = "sd",

  /**
   * High-definition output.
   */
  hd = "hd",
}

/**
 * Server-side task states, independent of upload progress.
 */
export enum NonRealtimeTaskStatus {

  /**
   * The task is submitted and awaiting server processing.
   */
  submitted = "submitted",

  /**
   * The server is processing the task.
   */
  processing = "processing",

  /**
   * Task processing is complete.
   */
  completed = "completed",

  /**
   * Task processing failed.
   */
  error = "error",
}

/**
 * Non-realtime submission options. Media must come from Xmax uploads, not local paths or Blob URLs.
 */
export interface NonRealtimeTaskOptions {

  /**
   * The model ID.
   */
  model: string;

  /**
   * The uploaded source video's URL.
   */
  videoPath: string;

  /**
   * The generation prompt, containing 1–1024 characters after trimming.
   */
  prompt: string;

  /**
   * The uploaded reference image URL; omission disables reference-image input.
   */
  referencePath?: string;

  /**
   * The output quality.
   */
  quality: NonRealtimeQuality;

  /**
   * An explicitly supported integer processing frame rate; omission retains the source rate, including
   * fractional values.
   */
  fps?: number;
}

/**
 * Non-realtime generation results. Missing and null server fields normalize to undefined.
 */
export interface NonRealtimeResult {

  /**
   * The generated file's access URL.
   */
  readonly url?: string;

  /**
   * The error reported while the server uploads the result.
   */
  readonly uploadError?: string;

  /**
   * The result upload status.
   */
  readonly uploadStatus?: string;

  /**
   * The server's finalization duration, in milliseconds.
   */
  readonly finalizeDurationMs?: number;

  /**
   * The compression level used by the server.
   */
  readonly compressionLevel?: string;

  /**
   * The result video's frame count.
   */
  readonly frameCount?: number;

  /**
   * The result video's frame rate, in fps.
   */
  readonly fps?: number;

  /**
   * The result video's duration, in milliseconds.
   */
  readonly durationMs?: number;

  /**
   * The result file size, in bytes.
   */
  readonly fileSizeBytes?: number;

  /**
   * The number of frames dropped during server processing.
   */
  readonly droppedFrameCount?: number;

  /**
   * The result size before compression, in bytes.
   */
  readonly originalFileSizeBytes?: number;
}

/**
 * A task snapshot whose ID and state support querying, recovery, and polling. Timestamp strings retain
 * the server representation without inferring a time zone.
 */
export interface NonRealtimeTask {

  /**
   * The task ID used for queries and recovery.
   */
  readonly uid: string;

  /**
   * The state returned by the server.
   */
  readonly status: NonRealtimeTaskStatus;

  /**
   * The business user ID.
   */
  readonly userUid?: string;

  /**
   * The prompt used for this video generation.
   */
  readonly prompt?: string;

  /**
   * The uploaded source video's URL.
   */
  readonly videoPath?: string;

  /**
   * The uploaded reference image's URL.
   */
  readonly referencePath?: string;

  /**
   * The server task processor ID.
   */
  readonly processorId?: string;

  /**
   * The generated result's output quality.
   */
  readonly quality?: NonRealtimeQuality;

  /**
   * The requested processing frame rate, in fps.
   */
  readonly requestedFps?: number;

  /**
   * The processing frame rate resolved by the server, in fps.
   */
  readonly resolvedFps?: number;

  /**
   * The number of retries performed by the server.
   */
  readonly retryCount?: number;

  /**
   * The source video's duration, in seconds.
   */
  readonly videoDurationSeconds?: number;

  /**
   * The billable duration reported by the server, in seconds.
   */
  readonly billableDurationSeconds?: number;

  /**
   * The task's consumed points reported by the server.
   */
  readonly chargePoints?: number;

  /**
   * The generated file and processing information.
   */
  readonly result?: NonRealtimeResult;

  /**
   * The server's task-processing start time.
   */
  readonly processStartTime?: string;

  /**
   * The task creation time.
   */
  readonly createTimestamp?: string;

  /**
   * The task's latest update time.
   */
  readonly updateTimestamp?: string;
}

/**
 * Task pagination options.
 */
export interface NonRealtimeTaskListOptions {

  /**
   * The one-based page number; defaults to 1.
   */
  pageNumber?: number;

  /**
   * The page capacity, from 1 to 100; defaults to 10.
   */
  pageSize?: number;

  /**
   * An optional task-state filter.
   */
  status?: NonRealtimeTaskStatus;
}

/**
 * A page of tasks ordered newest first by creation time.
 */
export interface NonRealtimeTaskPage {

  /**
   * The one-based current page number.
   */
  readonly pageNumber: number;

  /**
   * The current page capacity.
   */
  readonly pageSize: number;

  /**
   * The total number of matching tasks.
   */
  readonly total: number;

  /**
   * The current page's tasks, ordered newest first by creation time.
   */
  readonly list: readonly NonRealtimeTask[];
}
