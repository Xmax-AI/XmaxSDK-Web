//
//  XmaxNonRealtimeManager.ts
//  XmaxSDK
//
//  Author: 翁跃庭 (Yueting Weng)
//  GitHub: https://github.com/Xmax-AI/XmaxSDK-Web
//
//  Copyright (c) 2026 XMAX.AI PTE. LTD.
//

import { XmaxError, XmaxErrorCode } from "../../Foundation/Errors/XmaxError";
import { NonRealtimeTaskService, validateTaskUid } from "../../Service/NonRealtime/NonRealtimeTaskService";
import { NonRealtimeTaskError } from "../../Service/NonRealtime/NonRealtimeTaskError";
import {
  NonRealtimeTaskStatus,
  type NonRealtimeTask,
  type NonRealtimeTaskOptions,
  type NonRealtimeTaskListOptions
} from "../../Service/NonRealtime/NonRealtimeTask";
import type { NonRealtimeWaitOptions, XmaxNonRealtimeManaging } from "./XmaxNonRealtimeManaging";

/**
 * A non-realtime task facade with independent waits, sharing HTTP services without creating RTC
 * connections or realtime sessions.
 */
export class XmaxNonRealtimeManager implements XmaxNonRealtimeManaging {

  /**
   * The service that submits and queries non-realtime tasks.
   */
  private readonly tasks: NonRealtimeTaskService;

  /**
   * Creates a manager with a non-realtime task service.
   */
  constructor(
    tasks: NonRealtimeTaskService
  ) {
    this.tasks = tasks;
  }

  /**
   * Submits a task once without retrying a potentially billable request.
   */
  submitTask(
    options: NonRealtimeTaskOptions
  ): Promise<NonRealtimeTask> {
    return this.tasks.submitTask(options);
  }

  /**
   * Returns a task snapshot without treating a server-side task failure as a query failure.
   */
  getTask(
    taskUid: string,
    options?: {
      signal?: AbortSignal
    }
  ): Promise<NonRealtimeTask> {
    return this.tasks.getTask(
      taskUid,
      options?.signal
    );
  }

  /**
   * Returns snapshots for multiple tasks.
   */
  getTasks(
    taskUids: readonly string[]
  ): Promise<readonly NonRealtimeTask[]> {
    return this.tasks.getTasks(taskUids);
  }

  /**
   * Returns a page of tasks.
   */
  listTasks(
    options?: NonRealtimeTaskListOptions
  ) {
    return this.tasks.listTasks(options);
  }

  /**
   * Waits for completion using serial queries and bounded transient-error backoff. Cancellation and the
   * overall timeout cover requests and polling delays.
   */
  async waitForCompletion(
    taskUid: string,
    options: NonRealtimeWaitOptions = {}
  ): Promise<NonRealtimeTask> {
    const uid = validateTaskUid(taskUid);
    const interval = options.intervalMs ?? 2000;
    const retries = options.maxConsecutiveRetries ?? 3;
    validateDelay(interval);
    if (options.timeoutMs !== undefined) {
      validateDelay(options.timeoutMs);
    }
    if (!Number.isSafeInteger(retries) || retries < 0) {
      throw new XmaxError(
        XmaxErrorCode.invalidConfiguration,
        "Retry count must be a non-negative integer",
      );
    }

    const controller = new AbortController();
    let timedOut = false;
    const abort = () => controller.abort();
    options.signal?.addEventListener(
      "abort",
      abort,
      { once: true }
    );
    if (options.signal?.aborted) {
      abort();
    }
    const timer = options.timeoutMs === undefined ? undefined : setTimeout(
      () => {
        timedOut = true;
        abort();
      },
      options.timeoutMs
    );

    let failures = 0;
    try {
      for (; ;) {
        ensureActive(controller.signal);
        let task: NonRealtimeTask;
        try {
          task = await this.tasks.getTask(
            uid,
            controller.signal
          );
        } catch (error) {
          ensureActive(controller.signal);
          if (!isTransient(error) || failures >= retries) {
            throw error;
          }
          failures++;
          await delay(
            Math.min(interval * 2 ** (failures - 1), 30_000),
            controller.signal
          );
          continue;
        }

        ensureActive(controller.signal);
        failures = 0;
        // Observer failures must not change server state, resubmit tasks, or retry queries.
        try {
          void Promise.resolve(options.onTaskUpdated?.(task)).catch(() => { });
        } catch {
          // Observer errors are handled by the integrating app.
        }
        ensureActive(controller.signal);

        if (task.status === NonRealtimeTaskStatus.error) {
          throw new NonRealtimeTaskError(
            task,
            `Non-realtime task ${uid} failed`
          );
        }
        if (task.status === NonRealtimeTaskStatus.completed) {
          if (!isResultAvailable(task)) {
            throw new NonRealtimeTaskError(
              task,
              `Non-realtime task ${uid} completed without a usable result`,
            );
          }
          return task;
        }
        await delay(
          interval,
          controller.signal
        );
      }
    } catch (error) {
      if (timedOut) {
        throw new XmaxError(
          XmaxErrorCode.timeout,
          `Waiting for task ${uid} timed out; the server task was not cancelled`,
        );
      }
      ensureActive(controller.signal);
      throw error;
    } finally {
      clearTimeout(timer);
      options.signal?.removeEventListener(
        "abort",
        abort
      );
    }
  }
}

/**
 * Validates a positive duration supported by browser timers.
 */
function validateDelay(
  value: number
): void {
  if (!Number.isFinite(value) || value <= 0 || value > 2_147_483_647) {
    throw new XmaxError(
      XmaxErrorCode.invalidConfiguration,
      "Polling durations must be positive and within the timer range"
    );
  }
}

/**
 * Reports local cancellation without implying cancellation of the server task.
 */
function ensureActive(
  signal: AbortSignal
): void {
  if (signal.aborted) {
    throw new XmaxError(
      XmaxErrorCode.cancelled,
      "Task wait was cancelled locally; the server task was not cancelled",
    );
  }
}

/**
 * Waits for a cancellable polling interval and releases its timer and listener afterward.
 */
function delay(
  ms: number,
  signal: AbortSignal
): Promise<void> {
  return new Promise((
    resolve,
    reject
  ) => {
    const finish = () => {
      clearTimeout(timer);
      signal.removeEventListener(
        "abort",
        finish
      );
      try {
        ensureActive(signal);
        resolve();
      } catch (error) {
        reject(error);
      }
    };
    const timer = setTimeout(
      finish,
      ms
    );
    signal.addEventListener(
      "abort",
      finish,
      { once: true }
    );
    if (signal.aborted) {
      finish();
    }
  });
}

/**
 * Identifies retryable network failures, request timeouts, and server errors without an explicit
 * business rejection.
 */
function isTransient(
  error: unknown
): boolean {
  if (!(error instanceof XmaxError)) {
    return false;
  }
  return error.code === XmaxErrorCode.networkError || error.code === XmaxErrorCode.timeout ||
    (error.code === XmaxErrorCode.apiError && (error.httpStatus ?? 0) >= 500 &&
      (error.apiCode === undefined || error.apiCode === error.httpStatus));
}

/**
 * Checks for an HTTP(S) result URL without an explicit upload failure.
 */
function isResultAvailable(
  task: NonRealtimeTask
): boolean {
  const result = task.result;
  if (
    !result?.url?.trim() ||
    result.uploadError?.trim() ||
    (result.uploadStatus !== undefined && result.uploadStatus !== "success")
  ) {
    return false;
  }
  try {
    const url = new URL(result.url);
    return ["http:", "https:"].includes(url.protocol) && !url.username && !url.password;
  } catch {
    return false;
  }
}
