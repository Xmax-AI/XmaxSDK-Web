//
//  RealtimeState.ts
//  XmaxSDK
//
//  Author: 翁跃庭 (Yueting Weng)
//  GitHub: https://github.com/Xmax-AI/XmaxSDK-Web
//
//  Copyright (c) 2026 XMAX.AI PTE. LTD.
//

import { XmaxError } from "../../Foundation/Errors/XmaxError";

/**
 * The realtime connection lifecycle states.
 */
export enum RealtimeConnectionState {

  /**
   * No local media stream is available.
   */
  idle = "Idle",

  /**
   * Local media is being prepared. Cameras also wait for a valid frame and a bound preview view.
   */
  preparing = "Preparing",

  /**
   * Local media is ready for preview, connection, and generation.
   */
  ready = "Ready",

  /**
   * The session is being created, the RTC room joined, and local media published.
   */
  connecting = "Connecting",

  /**
   * The realtime connection is established without an active generation task.
   */
  connected = "Connected",

  /**
   * Generation is starting or the SDK video view is awaiting its first frame and render warmup. This
   * state may continue after startGeneration returns; your app must mount the video view.
   */
  starting = "Starting",

  /**
   * Generation is active and the SDK video view has completed warmup and begun presenting results.
   */
  generating = "Generating",

  /**
   * Generation, room, and session resources are being released.
   */
  disconnecting = "Disconnecting",
}

/**
 * The reason for entering a realtime state.
 */
export type RealtimeReason =
  | {

    /**
     * A state transition caused by a normal operation.
     */
    kind: "normal"
  }
  | {

    /**
     * A state transition caused by an orientation change.
     */
    kind: "orientationChanged"
  }
  | {

    /**
     * A state transition caused by a failure.
     */
    kind: "failure";

    /**
     * The error that caused the state transition.
     */
    error: XmaxError
  };

/**
 * State reasons for normal operations, orientation changes, and failures.
 */
export const RealtimeReason = {
  /**
   * The reason for a normal operation's state transition.
   */
  normal: { kind: "normal" } as RealtimeReason,
  /**
   * The reason for an orientation-related state transition.
   */
  orientationChanged: { kind: "orientationChanged" } as RealtimeReason,
  /**
   * Wraps an SDK error as a state-transition reason, preserving its code and message.
   */
  failure(
    error: XmaxError
  ): RealtimeReason {
    return {
      kind: "failure",
      error
    };
  },
};

/**
 * The lifecycle state, business identifiers, and transition reason for a snapshot.
 */
export interface RealtimeStateInit {

  /**
   * The current connection lifecycle state.
   */
  connectionState: RealtimeConnectionState;

  /**
   * The business session ID.
   */
  sessionID?: string;

  /**
   * The active generation task ID.
   */
  taskID?: string;

  /**
   * The reason for the operation's completion or transition.
   */
  reason?: RealtimeReason;
}

/**
 * A snapshot of the realtime lifecycle state.
 */
export class RealtimeState {

  /**
   * The current connection lifecycle state.
   */
  readonly connectionState: RealtimeConnectionState;

  /**
   * The current or most recent realtime session ID.
   */
  readonly sessionID?: string;

  /**
   * The active generation task ID.
   */
  readonly taskID?: string;

  /**
   * The reason for entering this state, cleared when a normal operation begins.
   */
  readonly reason?: RealtimeReason;

  /**
   * Creates a realtime state snapshot.
   */
  constructor(
    init: RealtimeStateInit
  ) {
    this.connectionState = init.connectionState;
    this.sessionID = init.sessionID;
    this.taskID = init.taskID;
    this.reason = init.reason;
  }

  /**
   * Compares connection state, session, task, and reason kind.
   *
   * @param other - The state to compare.
   */
  equals(
    other: RealtimeState
  ): boolean {
    return (
      this.connectionState === other.connectionState &&
      this.sessionID === other.sessionID &&
      this.taskID === other.taskID &&
      this.reason?.kind === other.reason?.kind
    );
  }
}

/**
 * Receives realtime state snapshots.
 */
export type RealtimeStateListener = (
  state: RealtimeState
) => void;
