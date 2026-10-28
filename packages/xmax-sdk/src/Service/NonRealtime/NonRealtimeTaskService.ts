//
//  NonRealtimeTaskService.ts
//  XmaxSDK
//
//  Author: 翁跃庭 (Yueting Weng)
//  GitHub: https://github.com/Xmax-AI/XmaxSDK-Web
//
//  Copyright (c) 2026 XMAX.AI PTE. LTD.
//

import { XmaxError, XmaxErrorCode } from "../../Foundation/Errors/XmaxError";
import type { ApiServicing } from "../Network/ApiServicing";
import {
  NonRealtimeQuality,
  NonRealtimeTaskStatus,
  type NonRealtimeResult,
  type NonRealtimeTask,
  type NonRealtimeTaskOptions,
  type NonRealtimeTaskListOptions,
  type NonRealtimeTaskPage,
} from "./NonRealtimeTask";

/**
 * Explicit processing frame rates accepted by the non-realtime API.
 */
const SUPPORTED_FPS = new Set([8, 10, 12, 15, 16, 18, 20, 22, 24, 25, 30, 45, 48, 50, 60, 72, 90, 100, 120]);

/**
 * A non-realtime HTTP service that validates and maps protocol fields without submission retries or
 * polling.
 */
export class NonRealtimeTaskService {

  /**
   * The API transport for task requests.
   */
  private readonly api: ApiServicing;

  /**
   * Creates a task service using the supplied API transport.
   */
  constructor(
    api: ApiServicing
  ) {
    this.api = api;
  }

  /**
   * Submits once without retrying ambiguous outcomes that might incur duplicate charges.
   */
  async submitTask(
    options: NonRealtimeTaskOptions
  ): Promise<NonRealtimeTask> {
    const model = options.model?.trim();
    if (!model) {
      invalid("Model must not be empty");
    }
    const prompt = options.prompt.trim();
    if (!prompt || [...prompt].length > 1024) {
      invalid("Prompt must contain 1–1024 characters");
    }
    validateURL(options.videoPath);
    if (options.referencePath !== undefined) {
      validateURL(options.referencePath);
    }
    if (!Object.values(NonRealtimeQuality).includes(options.quality)) {
      invalid("Quality must be sd or hd");
    }
    if (options.fps !== undefined && !SUPPORTED_FPS.has(options.fps)) {
      invalid("Unsupported processing frame rate");
    }

    const payload = await this.api.post<unknown>(
      "/offline-task",
      {
        model,
        prompt,
        refVideoPath: options.videoPath.trim(),
        ...(options.referencePath === undefined ? {} : { refImagePath: options.referencePath.trim() }),
        quality: options.quality,
        ...(options.fps === undefined ? {} : { fps: options.fps }),
      }
    );
    return parseTask(payload);
  }

  /**
   * Queries and validates a task ID; cancellation stops this HTTP query, not the server task.
   */
  async getTask(
    taskUid: string,
    signal?: AbortSignal
  ): Promise<NonRealtimeTask> {
    const uid = validateTaskUid(taskUid);
    const task = parseTask(await this.api.get<unknown>(
      `/offline-task/${encodeURIComponent(uid)}`,
      { signal }
    ));
    if (task.uid !== uid) {
      malformed("Task UID does not match the request");
    }
    return task;
  }

  /**
   * Queries at most 100 IDs, deduplicating in first-occurrence order and failing if any task is
   * unavailable.
   */
  async getTasks(
    taskUids: readonly string[]
  ): Promise<readonly NonRealtimeTask[]> {
    if (taskUids.length < 1 || taskUids.length > 100) {
      invalid("Provide 1–100 task UIDs");
    }
    const uids = [...new Set(taskUids.map(validateTaskUid))];
    const payload = record(await this.api.post<unknown>(
      "/offline-task/batch-query",
      { taskUids: uids }
    ));
    const tasks = parseList(payload.list);
    if (tasks.length !== uids.length || tasks.some((
      task,
      index
    ) => task.uid !== uids[index])) {
      malformed("Batch response does not match the requested task UIDs");
    }
    return tasks;
  }

  /**
   * Queries one page without implicitly loading additional pages.
   */
  async listTasks(
    options: NonRealtimeTaskListOptions = {}
  ): Promise<NonRealtimeTaskPage> {
    const pageNumber = options.pageNumber ?? 1;
    const pageSize = options.pageSize ?? 10;
    if (!Number.isSafeInteger(pageNumber) || pageNumber < 1) {
      invalid("Page number must be a positive integer");
    }
    if (!Number.isInteger(pageSize) || pageSize < 1 || pageSize > 100) {
      invalid("Page size must be between 1 and 100");
    }
    if (options.status !== undefined && !Object.values(NonRealtimeTaskStatus).includes(options.status)) {
      invalid("Invalid task status");
    }

    const query = new URLSearchParams({
      pageNumber: String(pageNumber),
      pageSize: String(pageSize)
    });
    if (options.status !== undefined) {
      query.set(
        "status",
        options.status
      );
    }
    const payload = record(await this.api.get<unknown>(`/offline-task/page?${query}`));
    return Object.freeze({
      pageNumber: pageInteger(
        payload,
        "pageNumber",
        1
      ),
      pageSize: pageInteger(
        payload,
        "pageSize",
        1
      ),
      total: pageInteger(
        payload,
        "total",
        0
      ),
      list: parseList(payload.list),
    });
  }
}

/**
 * Validates task IDs and rejects relative path segments that would change the normalized request target.
 */
export function validateTaskUid(
  value: string
): string {
  const uid = value.trim();
  if (!uid || uid === "." || uid === "..") {
    invalid("Task UID must not be empty or a relative path segment");
  }
  return uid;
}

/**
 * Validates network URL syntax; the server must verify that media originated from Xmax uploads.
 */
function validateURL(
  value: string
): void {
  let url: URL;
  try {
    url = new URL(value.trim());
  } catch {
    return invalid("Resource must be an uploaded HTTP(S) URL");
  }
  if (!["https:", "http:"].includes(url.protocol) || url.username || url.password) {
    invalid("Resource must be an uploaded HTTP(S) URL");
  }
}

/**
 * Reports invalid parameters as SDK configuration errors.
 */
function invalid(
  message: string
): never {
  throw new XmaxError(
    XmaxErrorCode.invalidConfiguration,
    message
  );
}

/**
 * Rejects malformed responses rather than treating missing state as perpetual processing.
 */
function malformed(
  message = "Invalid non-realtime response data"
): never {
  throw new XmaxError(
    XmaxErrorCode.apiError,
    message
  );
}

/**
 * Parses a response object.
 */
function record(
  value: unknown
): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    malformed();
  }
  return value as Record<string, unknown>;
}

/**
 * Reads optional fields without conflating missing values with zero.
 */
function field<T extends "string" | "number">(
  data: Record<string, unknown>,
  key: string,
  type: T
): (T extends "string" ? string : number) | undefined {
  const value = data[key];
  if (value === undefined || value === null) {
    return undefined;
  }
  if (typeof value !== type || (typeof value === "number" && (!Number.isFinite(value) || value < 0))) {
    malformed(`Invalid field: ${key}`);
  }
  return value as T extends "string" ? string : number;
}

/**
 * Validates required pagination integers.
 */
function pageInteger(
  data: Record<string, unknown>,
  key: string,
  minimum: number
): number {
  const value = field(
    data,
    key,
    "number"
  );
  if (value === undefined || !Number.isSafeInteger(value) || value < minimum) {
    malformed(`Invalid field: ${key}`);
  }
  return value;
}

/**
 * Parses a task array into immutable snapshots.
 */
function parseList(
  value: unknown
): readonly NonRealtimeTask[] {
  if (!Array.isArray(value)) {
    malformed("Missing task list");
  }
  return Object.freeze(value.map(parseTask));
}

/**
 * Maps task and result fields without inventing missing progress or failure details.
 */
function parseTask(
  value: unknown
): NonRealtimeTask {
  const data = record(value);
  const uid = field(
    data,
    "uid",
    "string"
  );
  const status = field(
    data,
    "status",
    "string"
  ) as NonRealtimeTaskStatus;
  const quality = field(
    data,
    "quality",
    "string"
  ) as NonRealtimeQuality | undefined;
  if (!uid?.trim() || !Object.values(NonRealtimeTaskStatus).includes(status)) {
    malformed("Missing task UID or invalid status");
  }
  if (quality !== undefined && !Object.values(NonRealtimeQuality).includes(quality)) {
    malformed("Invalid task quality");
  }

  return Object.freeze({
    uid,
    status,
    quality,
    userUid: field(
      data,
      "userUid",
      "string"
    ),
    prompt: field(
      data,
      "prompt",
      "string"
    ),
    videoPath: field(
      data,
      "refVideoPath",
      "string"
    ),
    referencePath: field(
      data,
      "refImagePath",
      "string"
    ),
    processorId: field(
      data,
      "processorId",
      "string"
    ),
    requestedFps: field(
      data,
      "requestedFps",
      "number"
    ),
    resolvedFps: field(
      data,
      "resolvedFps",
      "number"
    ),
    retryCount: field(
      data,
      "retryCount",
      "number"
    ),
    videoDurationSeconds: field(
      data,
      "videoDurationSeconds",
      "number"
    ),
    billableDurationSeconds: field(
      data,
      "billableDurationSeconds",
      "number"
    ),
    chargePoints: field(
      data,
      "chargePoints",
      "number"
    ),
    result: data.result == null ? undefined : parseResult(data.result),
    processStartTime: field(
      data,
      "processStartTime",
      "string"
    ),
    createTimestamp: field(
      data,
      "createTimestamp",
      "string"
    ),
    updateTimestamp: field(
      data,
      "updateTimestamp",
      "string"
    ),
  });
}

/**
 * Maps server snake_case result fields to SDK camelCase fields.
 */
function parseResult(
  value: unknown
): NonRealtimeResult {
  const data = record(value);
  return Object.freeze({
    url: field(
      data,
      "result_url",
      "string"
    ),
    uploadError: field(
      data,
      "upload_error",
      "string"
    ),
    uploadStatus: field(
      data,
      "upload_status",
      "string"
    ),
    finalizeDurationMs: field(
      data,
      "finalize_duration_ms",
      "number"
    ),
    compressionLevel: field(
      data,
      "compression_level",
      "string"
    ),
    frameCount: field(
      data,
      "frame_count",
      "number"
    ),
    fps: field(
      data,
      "fps",
      "number"
    ),
    durationMs: field(
      data,
      "result_duration_ms",
      "number"
    ),
    fileSizeBytes: field(
      data,
      "file_size_bytes",
      "number"
    ),
    droppedFrameCount: field(
      data,
      "dropped_frame_count",
      "number"
    ),
    originalFileSizeBytes: field(
      data,
      "original_file_size_bytes",
      "number"
    ),
  });
}
