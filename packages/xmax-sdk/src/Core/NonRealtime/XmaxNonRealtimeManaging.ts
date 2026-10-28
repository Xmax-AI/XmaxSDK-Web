//
//  XmaxNonRealtimeManaging.ts
//  XmaxSDK
//
//  Author: 翁跃庭 (Yueting Weng)
//  GitHub: https://github.com/Xmax-AI/XmaxSDK-Web
//
//  Copyright (c) 2026 XMAX.AI PTE. LTD.
//

import type {
  NonRealtimeTask,
  NonRealtimeTaskOptions,
  NonRealtimeTaskListOptions,
  NonRealtimeTaskPage,
} from "../../Service/NonRealtime/NonRealtimeTask";

/**
 * Local task-waiting options. All durations are in milliseconds.
 */
export interface NonRealtimeWaitOptions {

  /**
   * The positive delay after each successful query; defaults to 2000.
   */
  intervalMs?: number;

  /**
   * The positive overall timeout; omission waits until a terminal state or cancellation.
   */
  timeoutMs?: number;

  /**
   * The allowed consecutive transient failures, reset after a successful query; defaults to 3. Zero
   * disables retries.
   */
  maxConsecutiveRetries?: number;

  /**
   * Cancels local polling and pending queries without cancelling the server task or refunding charges.
   */
  signal?: AbortSignal;

  /**
   * Receives every successful query snapshot, including terminal states, not a generation percentage.
   * Observer failures do not affect polling.
   */
  onTaskUpdated?: (
    task: NonRealtimeTask
  ) => void;
}

/**
 * Independent non-realtime tasks and wait operations, without a single current task.
 */
export interface XmaxNonRealtimeManaging {

  /**
   * Submits a task without waiting for generation, uploading resources, or retrying submission. A
   * timeout or invalid response does not prove that task creation failed; submitting again may incur
   * another charge.
   */
  submitTask(
    options: NonRealtimeTaskOptions
  ): Promise<NonRealtimeTask>;

  /**
   * Queries one task, returning server error states without rejecting the HTTP query.
   */
  getTask(
    taskUid: string,
    options?: {
      signal?: AbortSignal
    }
  ): Promise<NonRealtimeTask>;

  /**
   * Queries up to 100 task IDs, deduplicated and returned in request order. The whole query fails if any
   * task is missing or inaccessible.
   */
  getTasks(
    taskUids: readonly string[]
  ): Promise<readonly NonRealtimeTask[]>;

  /**
   * Lists tasks, defaulting to page 1 with 10 items; at most 100 items per page.
   */
  listTasks(
    options?: NonRealtimeTaskListOptions
  ): Promise<NonRealtimeTaskPage>;

  /**
   * Polls serially until the task is completed and its result URL is available. A task error rejects
   * with NonRealtimeTaskError. Timeout or cancellation ends only this local wait; the same task ID
   * remains queryable.
   */
  waitForCompletion(
    taskUid: string,
    options?: NonRealtimeWaitOptions
  ): Promise<NonRealtimeTask>;
}
