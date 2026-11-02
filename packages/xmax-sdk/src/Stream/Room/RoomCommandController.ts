//
//  RoomCommandController.ts
//  XmaxSDK
//
//  Author: 翁跃庭 (Yueting Weng)
//  GitHub: https://github.com/Xmax-AI/XmaxSDK-Web
//
//  Copyright (c) 2026 XMAX.AI PTE. LTD.
//

import { XmaxError, XmaxErrorCode } from "../../Foundation/Errors/XmaxError";
import { XmaxLogger } from "../../Foundation/Logging/XmaxLogger";

/**
 * Retry offsets from the first attempt, in milliseconds.
 */
const RETRY_OFFSETS_MS = [300, 1000, 3000, 3300, 4000] as const;

/**
 * The maximum time retaining background retries, in milliseconds.
 */
const RETRY_DEADLINE_MS = 6000;

/**
 * Commands whose background retries stop on service acknowledgement.
 */
export type RoomCommandKind = "start" | "change_condition" | "change_target_size";

/**
 * An immutable command and its independent initial-send and background-retry resources.
 */
interface PendingCommand {
  /**
   * The command's event name.
   */
  kind: RoomCommandKind;

  /**
   * The task to which the command belongs.
   */
  taskID: string;

  /**
   * The identifier shared by every attempt.
   */
  xid: string;

  /**
   * The serialized payload retained unchanged across attempts.
   */
  message: string;

  /**
   * Cancels the original transport send when explicitly superseded or stopped.
   */
  initialController: AbortController;

  /**
   * Cancels queued and in-flight redundant attempts independently of the original send.
   */
  retryController: AbortController;

  /**
   * The scheduled redundant attempts and final retry deadline.
   */
  timers: Array<ReturnType<typeof setTimeout>>;

  /**
   * The number of attempts submitted to the transport.
   */
  attempts: number;

  /**
   * Whether another redundant attempt may be scheduled.
   */
  retrying: boolean;

  /**
   * Whether a complete transport attempt succeeded.
   */
  sent: boolean;

  /**
   * Whether a task transition or supersession explicitly cancelled this command.
   */
  cancelled: boolean;

  /**
   * Checks operation validity before each attempt or matched ACK.
   */
  ensureCurrent?: () => void;

  /**
   * Completes the caller's send operation without requiring an ACK.
   */
  resolve: () => void;

  /**
   * Rejects an incomplete send for transport failure or explicit cancellation.
   */
  reject: (
    error: XmaxError
  ) => void;
}

/**
 * Adds background redundancy at 0/300/1000 and 3000/3300/4000 ms. ACKs stop retries; they never gate
 * generation, subsequent commands, or rendering. Initial sends preserve their logical order.
 */
export class RoomCommandController {
  /**
   * Commands with pending sends or background retries, indexed by their unique xid.
   */
  private readonly pending = new Map<string, PendingCommand>();

  /**
   * Orders initial sends without waiting for service ACKs or completed retry schedules.
   */
  private sendTail: Promise<void> = Promise.resolve();

  /**
   * Creates a controller with a cancellable transport and an optional identifier generator.
   */
  constructor(
    private readonly sendMessage: (
      message: string,
      signal: AbortSignal
    ) => Promise<void>,
    private readonly makeID: () => string = () => crypto.randomUUID(),
  ) { }

  /**
   * Sends a new logical command. Resolves after the first successful attempt; a missing ACK only stops
   * background retries with a warning. New starts supersede all old work; same-kind task updates
   * supersede older updates of that kind. Serialization happens before any old command is cancelled.
   */
  send(
    kind: RoomCommandKind,
    taskID: string,
    createMessage: (
      xid: string
    ) => string,
    ensureCurrent?: () => void,
  ): Promise<void> {
    ensureCurrent?.();
    const xid = this.makeID();
    const message = createMessage(xid);
    let resolve!: () => void;
    let reject!: (error: XmaxError) => void;
    const sent = new Promise<void>((res, rej) => {
      resolve = res;
      reject = rej;
    });
    // Observe cancellation even if it precedes the caller attaching its own handler.
    void sent.catch(() => { });
    this.cancelMatching(command => kind === "start" ||
      (command.taskID === taskID && command.kind === kind));
    const command: PendingCommand = {
      kind,
      taskID,
      xid,
      message,
      ensureCurrent,
      resolve,
      reject,
      initialController: new AbortController(),
      retryController: new AbortController(),
      timers: [],
      attempts: 0,
      retrying: true,
      sent: false,
      cancelled: false,
    };
    this.pending.set(xid, command);
    const operation = this.sendTail.then(() => {
      if (!command.cancelled) {
        this.begin(command);
      }
      return sent;
    });
    this.sendTail = operation.catch(() => { });
    return sent;
  }

  /**
   * Stops retransmission for a matching command without resolving or rejecting its transport result.
   */
  acknowledge(
    message: Record<string, unknown>
  ): void {
    const command = typeof message.xid === "string" ? this.pending.get(message.xid) : undefined;
    if (!command || !command.retrying || command.attempts === 0 || message.event !== "xid_ack" ||
      typeof message.count !== "number" || !Number.isSafeInteger(message.count) || message.count < 1) {
      return;
    }
    try {
      command.ensureCurrent?.();
      this.stopRetries(command);
    } catch (error) {
      this.cancelCommand(command, XmaxError.from(error));
    }
  }

  /**
   * Cancels pending sends and retries for an ended task, or every command before leaving the room.
   */
  cancel(
    taskID?: string
  ): void {
    this.cancelMatching(command => taskID === undefined || command.taskID === taskID);
  }

  /**
   * Releases commands matching a task or supersession boundary.
   */
  private cancelMatching(
    matches: (
      command: PendingCommand
    ) => boolean
  ): void {
    for (const command of [...this.pending.values()]) {
      if (matches(command)) {
        this.cancelCommand(command, new XmaxError(
          XmaxErrorCode.cancelled,
          "RTC command was cancelled",
        ));
      }
    }
  }

  /**
   * Starts a command's first send and retry clock after preceding initial sends complete.
   */
  private begin(
    command: PendingCommand
  ): void {
    for (const delay of RETRY_OFFSETS_MS) {
      command.timers.push(setTimeout(() => this.attempt(command, false), delay));
    }
    command.timers.push(setTimeout(() => {
      if (!command.retrying) {
        return;
      }
      XmaxLogger.room.warning(() =>
        `RTC command ACK not received after ${RETRY_DEADLINE_MS} ms; retries stopped: ${command.kind}, xid: ${command.xid}, attempts: ${command.attempts}`);
      this.stopRetries(command);
    }, RETRY_DEADLINE_MS));
    this.attempt(command, true);
  }

  /**
   * Submits a transport attempt without waiting for a service receipt. An initial transport failure
   * retains the original failure behavior; redundant-send failures never fail an already sent task.
   */
  private attempt(
    command: PendingCommand,
    initial: boolean,
  ): void {
    if (!command.retrying || command.cancelled) {
      return;
    }
    try {
      command.ensureCurrent?.();
      command.attempts++;
      const signal = initial ? command.initialController.signal : command.retryController.signal;
      void this.sendMessage(command.message, signal).then(
        () => this.completeSend(command),
        error => {
          if (command.cancelled || !command.retrying && command.sent) {
            return;
          }
          const mapped = XmaxError.from(error);
          if (initial && !command.sent) {
            if (command.kind === "start") {
              this.cancelMatching(item => item !== command && item.taskID === command.taskID);
            }
            this.cancelCommand(command, mapped);
          } else if (command.retrying && mapped.code !== XmaxErrorCode.cancelled) {
            XmaxLogger.room.warning(() =>
              `RTC command retry send failed: ${command.kind}, xid: ${command.xid}, attempt: ${command.attempts}, reason: ${mapped.message}`);
          }
        },
      );
    } catch (error) {
      this.cancelCommand(command, XmaxError.from(error));
    }
  }

  /**
   * Completes sending once, allowing normal generation and the next initial command to continue.
   */
  private completeSend(
    command: PendingCommand
  ): void {
    if (command.cancelled || command.sent) {
      return;
    }
    command.sent = true;
    command.resolve();
    if (!command.retrying) {
      command.initialController.abort();
      this.pending.delete(command.xid);
    }
  }

  /**
   * Stops background work without failing or cancelling an original transport send still in progress.
   */
  private stopRetries(
    command: PendingCommand
  ): void {
    command.retrying = false;
    command.timers.forEach(timer => clearTimeout(timer));
    command.retryController.abort();
    if (command.sent) {
      command.initialController.abort();
      this.pending.delete(command.xid);
    }
  }

  /**
   * Cancels both original and redundant sends at an explicit lifecycle or supersession boundary.
   */
  private cancelCommand(
    command: PendingCommand,
    error: XmaxError,
  ): void {
    command.cancelled = true;
    command.retrying = false;
    command.timers.forEach(timer => clearTimeout(timer));
    command.initialController.abort();
    command.retryController.abort();
    this.pending.delete(command.xid);
    command.reject(error);
  }
}
