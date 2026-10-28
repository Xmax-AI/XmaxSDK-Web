//
//  RealtimeCoordinator.ts
//  XmaxSDK
//
//  Author: 翁跃庭 (Yueting Weng)
//  GitHub: https://github.com/Xmax-AI/XmaxSDK-Web
//
//  Copyright (c) 2026 XMAX.AI PTE. LTD.
//

import { XmaxError, XmaxErrorCode } from "../../Foundation/Errors/XmaxError";
import {
  RealtimeConnectionState,
  RealtimeReason,
  RealtimeState,
  type RealtimeStateListener,
} from "../../Service/Realtime/RealtimeState";
import type { RealtimeErrorHandler } from "./RealtimeErrorHandler";

/**
 * Realtime operation kinds; only one operation is admitted at a time.
 */
export enum RealtimeOperationKind {

  /**
   * Prepares or releases a local media source.
   */
  media = "media",

  /**
   * Creates a session and RTC connection.
   */
  connection = "connection",

  /**
   * Starts a generation task or updates its conditions.
   */
  generation = "generation",

  /**
   * Replaces a generation task while retaining the connection, with generation-lifecycle failure
   * cleanup.
   */
  generationRestart = "generationRestart",

  /**
   * Switches the active camera.
   */
  cameraSwitch = "cameraSwitch",

  /**
   * Updates conditions or returned dimensions without changing the generation lifecycle.
   */
  configuration = "configuration",
}

/**
 * Cleanup scopes ordered from narrower to broader; concurrent termination requests use the broadest
 * scope.
 */
export enum RealtimeTerminationScope {

  /**
   * Stops generation and disconnects while retaining local media.
   */
  connection = 0,

  /**
   * Stops generation, disconnects, and releases local media.
   */
  all = 1,
}

/**
 * Determines whether a termination scope affects an operation kind.
 */
function scopeAffects(
  scope: RealtimeTerminationScope,
  kind: RealtimeOperationKind,
): boolean {
  if (scope === RealtimeTerminationScope.all) {
    return true;
  }
  return kind !== RealtimeOperationKind.media;
}

/**
 * Resources remaining after cleanup.
 */
export interface RealtimeCleanupResult {

  /**
   * The business session ID.
   */
  sessionID?: string;

  /**
   * Whether usable local media remains after cleanup.
   */
  hasLocalMedia: boolean;
}

/**
 * The manager-provided cleanup operation for a termination scope.
 */
export type RealtimeCleanupHandler = (
  scope: RealtimeTerminationScope,
  taskID: string,
) => Promise<RealtimeCleanupResult>;

/**
 * A lifecycle lease for validating operations and selecting failure cleanup.
 */
export interface RealtimeOperationToken {

  /**
   * Sets the resources to release if the operation fails or its caller cancels it.
   */
  setFailureScope(
    scope: RealtimeTerminationScope
  ): void;

  /**
   * Verifies lifecycle ownership after an asynchronous boundary.
   */
  ensureCurrent(): void;

  /**
   * Whether the lease remains valid, for synchronous lower-level validity callbacks.
   */
  readonly isCurrent: boolean;

  /**
   * The cancellation signal for interruptible work such as fetch.
   */
  readonly signal: AbortSignal;
}

/**
 * An operation lease that tracks cleanup scope and propagates cancellation to asynchronous work.
 */
class OperationLease implements RealtimeOperationToken {

  /**
   * Whether this lease still owns its operation.
   */
  private valid = true;

  /**
   * The error that terminated the operation.
   */
  private terminalError?: XmaxError;

  /**
   * The resources to clean up if this operation fails.
   */
  private storedFailureScope?: RealtimeTerminationScope;

  /**
   * The cancellation controller shared by this operation's asynchronous waits.
   */
  private readonly abortController = new AbortController();

  /**
   * Creates an operation lease without expanding cleanup when no failure scope is supplied.
   */
  constructor(
    failureScope?: RealtimeTerminationScope
  ) {
    this.storedFailureScope = failureScope;
  }

  /**
   * Whether the lease remains valid for committing asynchronous results.
   */
  get isCurrent(): boolean {
    return this.valid;
  }

  /**
   * The first invalidation error; undefined for cancellation without an explicit reason.
   */
  get failure(): XmaxError | undefined {
    return this.terminalError;
  }

  /**
   * The resources to release on operation failure or cancellation.
   */
  get failureScope(): RealtimeTerminationScope | undefined {
    return this.storedFailureScope;
  }

  /**
   * The signal aborted synchronously when the lease is invalidated.
   */
  get signal(): AbortSignal {
    return this.abortController.signal;
  }

  /**
   * Sets the resources to release if the operation fails or its caller cancels it.
   */
  setFailureScope(
    scope: RealtimeTerminationScope
  ): void {
    this.storedFailureScope = scope;
  }

  /**
   * Invalidates the lease and aborts pending work, preserving the first termination reason.
   */
  invalidate(
    error?: XmaxError
  ): void {
    this.valid = false;
    if (!this.terminalError) {
      this.terminalError = error;
    }
    this.abortController.abort();
  }

  /**
   * Verifies lifecycle ownership after an asynchronous boundary.
   */
  ensureCurrent(): void {
    if (!this.valid) {
      throw this.terminalError ?? RealtimeCoordinator.cancelledError();
    }
  }
}

/**
 * An active operation and its cancellation and cleanup progress.
 */
interface Operation {

  /**
   * The operation's unique ID.
   */
  id: string;

  /**
   * The operation kind.
   */
  kind: RealtimeOperationKind;

  /**
   * The lifecycle lease owned by this operation.
   */
  lease: OperationLease;

  /**
   * The promise resolved after the operation or its cleanup finishes.
   */
  completion: Promise<void>;

  /**
   * The termination task waiting for this operation to finish.
   */
  terminationTask?: Promise<void>;
}

/**
 * A termination request's cleanup scope and pending work.
 */
interface Termination {

  /**
   * The unique termination ID.
   */
  id: string;

  /**
   * The requested cleanup scope.
   */
  target: RealtimeTerminationScope;

  /**
   * The reason for the operation's completion or transition.
   */
  reason: RealtimeReason;

  /**
   * The SDK error responsible for the failure.
   */
  error?: XmaxError;

  /**
   * The business session ID.
   */
  sessionID?: string;

  /**
   * Pending operations that must settle before cleanup.
   */
  waitForOperations: Array<() => Promise<void>>;

  /**
   * The shared promise for this termination.
   */
  task: Promise<void>;
}

/**
 * The increasing ID source for operations and termination requests.
 */
let operationSequence = 0;

/**
 * Coordinates operation admission, state commits, and scoped cleanup. Promise chains and operation
 * leases serialize work within the JavaScript event loop.
 */
export class RealtimeCoordinator {

  /**
   * The handler that reports lifecycle failures.
   */
  private readonly errorHandler: RealtimeErrorHandler;

  /**
   * The callback that releases resources for a termination scope.
   */
  private readonly cleanup: RealtimeCleanupHandler;

  /**
   * The latest committed lifecycle state.
   */
  private state = new RealtimeState({
    connectionState: RealtimeConnectionState.idle,
  });

  /**
   * The app's realtime state listener.
   */
  private stateListener?: RealtimeStateListener;

  /**
   * The operation currently admitted to the lifecycle.
   */
  private activeOperation?: Operation;

  /**
   * The active termination request.
   */
  private termination?: Termination;

  /**
   * Creates a coordinator with error reporting and scoped cleanup.
   */
  constructor(
    options: {
      errorHandler: RealtimeErrorHandler;
      cleanup: RealtimeCleanupHandler;
    }
  ) {
    this.errorHandler = options.errorHandler;
    this.cleanup = options.cleanup;
  }

  /**
   * The latest realtime state snapshot.
   */
  get currentState(): RealtimeState {
    return this.state;
  }

  /**
   * Whether foreground work or cleanup prevents automatic quality adaptation from acquiring a lease.
   */
  get isBusy(): boolean {
    return this.activeOperation !== undefined || this.termination !== undefined;
  }

  /**
   * Sets the state listener and immediately replays the current state.
   *
   * @param listener - The callback; undefined removes it.
   */
  async setStateListener(
    listener?: RealtimeStateListener
  ): Promise<void> {
    this.stateListener = listener;
    if (listener) {
      listener(this.state);
    }
  }

  /**
   * Admits and executes one realtime operation. Cancelling a lifecycle operation completes scoped
   * cleanup first. Cancelling only a configuration update does not stop generation.
   *
   * @param kind - The operation kind.
   * @param failureScope - The automatic failure cleanup scope; omission only reports failures.
   * @param body - The operation body, which validates its lease across asynchronous boundaries.
   * @returns The operation result.
   * @throws Rejects with invalidConfiguration if another operation or termination is active.
   */
  async run<Value>(
    kind: RealtimeOperationKind,
    failureScope: RealtimeTerminationScope | undefined,
    body: (
      token: RealtimeOperationToken
    ) => Promise<Value>,
  ): Promise<Value> {
    if (this.termination || this.activeOperation) {
      const error = new XmaxError(
        XmaxErrorCode.invalidConfiguration,
        "Another realtime operation is in progress; wait for it to finish",
      );
      await this.errorHandler.report(error);
      throw error;
    }

    // Ordinary calls update active generation; explicit restarts retain a separate lifecycle kind.
    const operationKind =
      kind === RealtimeOperationKind.generation &&
        (this.state.connectionState === RealtimeConnectionState.generating ||
          (this.state.connectionState === RealtimeConnectionState.starting && !!this.state.taskID))
        ? RealtimeOperationKind.configuration
        : kind;

    const lease = new OperationLease(failureScope);
    const resultPromise = (async () => body(lease))();
    const operation: Operation = {
      id: `op-${(operationSequence += 1)}`,
      kind: operationKind,
      lease,
      completion: resultPromise.then(
        () => undefined,
        () => undefined,
      ),
    };
    this.activeOperation = operation;

    try {
      const value = await resultPromise;
      lease.ensureCurrent();
      this.finish(operation);
      return value;
    } catch (error) {
      return this.handleFailure(
        error,
        operation
      );
    }
  }

  /**
   * Commits public state only for the current operation.
   */
  async commit(
    nextState: RealtimeState,
    token: RealtimeOperationToken,
  ): Promise<void> {
    token.ensureCurrent();
    await this.setState(nextState);
  }

  /**
   * Completes media preparation when the current local preview is ready.
   */
  async localPreviewDidBecomeReady(
    isCurrent: () => boolean
  ): Promise<void> {
    if (
      this.state.connectionState !== RealtimeConnectionState.preparing ||
      !isCurrent()
    ) {
      return;
    }
    await this.setState(
      new RealtimeState({ connectionState: RealtimeConnectionState.ready }),
    );
  }

  /**
   * Enters generating only when the current task and presentation are ready; stale callbacks cannot
   * restore ended tasks.
   */
  async remotePreviewDidBecomeReady(
    sessionID: string,
    taskID: string,
    isCurrent: () => boolean,
  ): Promise<void> {
    if (this.termination || this.state.connectionState !== RealtimeConnectionState.starting ||
      this.state.sessionID !== sessionID || this.state.taskID !== taskID || !isCurrent()) {
      return;
    }

    await this.setState(new RealtimeState({
      connectionState: RealtimeConnectionState.generating,
      sessionID,
      taskID,
    }));
  }

  /**
   * Disconnects and cancels active work, including work that has not committed a connection state.
   */
  async disconnect(
    reason: RealtimeReason = RealtimeReason.normal
  ): Promise<void> {
    const task = await this.beginDisconnect(reason);
    await task;
  }

  /**
   * Begins disconnecting and returns its cleanup task without requiring local-media changes to await
   * network teardown.
   */
  async beginDisconnect(
    reason: RealtimeReason,
  ): Promise<Promise<void> | undefined> {
    const hasConnectionOperation = this.activeOperation
      ? scopeAffects(
        RealtimeTerminationScope.connection,
        this.activeOperation.kind
      )
      : false;
    const state = this.state.connectionState;
    const needsDisconnect =
      hasConnectionOperation ||
      this.termination !== undefined ||
      (state !== RealtimeConnectionState.idle &&
        state !== RealtimeConnectionState.preparing &&
        state !== RealtimeConnectionState.ready);
    if (!needsDisconnect) {
      return undefined;
    }

    return this.requestTermination(
      RealtimeTerminationScope.connection,
      undefined,
      reason,
    );
  }

  /**
   * Terminates a scope and awaits cleanup, merging concurrent requests into the broadest scope.
   */
  async terminate(
    target: RealtimeTerminationScope,
    reason: RealtimeReason = RealtimeReason.normal,
  ): Promise<void> {
    const task = await this.requestTermination(
      target,
      undefined,
      reason
    );
    await task;
  }

  /**
   * Cleans up a current-lifecycle background failure and exposes its reason in the final state.
   */
  async terminateWithError(
    error: XmaxError,
    target: RealtimeTerminationScope,
    isCurrent: () => boolean = () => true,
  ): Promise<void> {
    if (!isCurrent()) {
      return;
    }
    // Late remote failures must not replace an intentional termination; local-media failures may still broaden cleanup.
    if (this.termination && target !== RealtimeTerminationScope.all) {
      return;
    }
    const task = await this.requestTermination(
      target,
      error,
      RealtimeReason.failure(error),
    );
    await task;
  }

  /**
   * Routes cancellation through termination and other failures through scoped cleanup or reporting.
   */
  private async handleFailure<Value>(
    error: unknown,
    operation: Operation,
  ): Promise<Value> {
    const operationWasCancelled =
      (error instanceof XmaxError && error.code === XmaxErrorCode.cancelled) ||
      (error instanceof DOMException && error.name === "AbortError") ||
      !operation.lease.isCurrent;

    if (operationWasCancelled) {
      // Cancelling a configuration request alone must not stop generation; disconnect and close still await cleanup.
      if (
        (operation.kind === RealtimeOperationKind.configuration ||
          operation.lease.failureScope === undefined) &&
        operation.terminationTask === undefined &&
        this.termination === undefined
      ) {
        this.finish(operation);
        if (
          operation.kind === RealtimeOperationKind.media &&
          this.state.connectionState === RealtimeConnectionState.preparing
        ) {
          await this.setState(
            new RealtimeState({ connectionState: RealtimeConnectionState.idle }),
          );
        }
        throw RealtimeCoordinator.cancelledError();
      }
      const terminationTask =
        operation.terminationTask ??
        this.termination?.task ??
        (await this.requestTermination(
          operation.lease.failureScope ?? RealtimeTerminationScope.connection,
          undefined,
          RealtimeReason.normal,
          operation,
        ));
      await terminationTask;
      this.finish(operation);
      throw operation.lease.failure ?? RealtimeCoordinator.cancelledError();
    }

    const resolvedError = XmaxError.from(error);
    if (
      operation.kind !== RealtimeOperationKind.configuration &&
      operation.lease.failureScope !== undefined
    ) {
      const terminationTask = await this.requestTermination(
        operation.lease.failureScope,
        resolvedError,
        RealtimeReason.failure(resolvedError),
        operation,
      );
      await terminationTask;
    } else {
      this.finish(operation);
      if (
        operation.kind === RealtimeOperationKind.media &&
        this.state.connectionState === RealtimeConnectionState.preparing
      ) {
        await this.setState(
          new RealtimeState({ connectionState: RealtimeConnectionState.idle }),
        );
      }
      await this.errorHandler.report(resolvedError);
      throw resolvedError;
    }

    this.finish(operation);
    throw resolvedError;
  }

  /**
   * Begins or merges termination, invalidates obsolete operations, and enters disconnecting.
   */
  private async requestTermination(
    target: RealtimeTerminationScope,
    error: XmaxError | undefined,
    reason: RealtimeReason,
    origin?: Operation,
  ): Promise<Promise<void>> {
    let pending = this.termination;
    if (pending) {
      if (target > pending.target) {
        pending.target = target;
      }
      if (!pending.error) {
        pending.error = error;
      }
      if (error && pending.error === error) {
        pending.reason = RealtimeReason.failure(error);
      }
    } else {
      pending = {
        id: `term-${(operationSequence += 1)}`,
        target,
        reason,
        error,
        waitForOperations: [],
        task: Promise.resolve(),
      };
      this.termination = pending;
      pending.task = this.performTermination(pending.id);
    }

    const active = this.activeOperation;
    if (active && active !== origin && scopeAffects(
      pending.target,
      active.kind
    )) {
      active.lease.invalidate(pending.error);
      active.terminationTask = pending.task;
      pending.waitForOperations.push(() => active.completion);
    } else if (origin) {
      origin.lease.invalidate(error);
      origin.terminationTask = pending.task;
      pending.waitForOperations.push(() => origin.completion);
    }

    await this.setState(
      new RealtimeState({
        connectionState: RealtimeConnectionState.disconnecting,
        sessionID: this.state.sessionID,
      }),
    );

    return pending.task;
  }

  /**
   * Awaits obsolete operations, releases scoped resources, and commits the final state.
   */
  private async performTermination(
    id: string
  ): Promise<void> {
    const pending = this.termination;
    if (!pending || pending.id !== id) {
      return;
    }

    for (; ;) {
      const waiters = pending.waitForOperations;
      pending.waitForOperations = [];
      for (const waiter of waiters) {
        await waiter();
      }

      const requestedTarget = pending.target;
      const result = await this.cleanup(
        requestedTarget,
        this.state.taskID ?? "",
      );
      if (result.sessionID) {
        pending.sessionID = result.sessionID;
      }

      if (pending.target !== requestedTarget || pending.waitForOperations.length > 0) {
        continue;
      }

      const connectionState =
        requestedTarget === RealtimeTerminationScope.all
          ? RealtimeConnectionState.idle
          : result.hasLocalMedia
            ? RealtimeConnectionState.ready
            : RealtimeConnectionState.idle;
      const finalState = new RealtimeState({
        connectionState,
        sessionID: pending.sessionID ?? this.state.sessionID,
        reason: pending.reason,
      });
      // Finish internal bookkeeping before notifying observers so obsolete work cannot overwrite a reentrant close.
      const active = this.activeOperation;
      if (active && scopeAffects(
        requestedTarget,
        active.kind
      )) {
        this.finish(active);
      }
      const listener = !this.state.equals(finalState)
        ? this.stateListener
        : undefined;
      this.state = finalState;
      this.termination = undefined;
      this.errorHandler.invalidatePendingFailures(requestedTarget);
      if (listener) {
        listener(finalState);
      }
      if (pending.error) {
        await this.errorHandler.report(pending.error);
      }
      return;
    }
  }

  /**
   * Completes an operation and releases its admission slot.
   */
  private finish(
    operation: Operation
  ): void {
    if (this.activeOperation?.id === operation.id) {
      this.activeOperation = undefined;
    }
  }

  /**
   * Commits and notifies a changed state, suppressing equivalent snapshots.
   */
  private async setState(
    nextState: RealtimeState
  ): Promise<void> {
    if (this.state.equals(nextState)) {
      return;
    }
    this.state = nextState;
    this.stateListener?.(nextState);
  }

  /**
   * Creates the standard operation-cancellation error.
   */
  static cancelledError(): XmaxError {
    return new XmaxError(
      XmaxErrorCode.cancelled,
      "Realtime operation was cancelled",
    );
  }
}
