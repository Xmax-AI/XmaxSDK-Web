//
//  XmaxRealtimeGenerationManager.ts
//  XmaxSDK
//
//  Author: 翁跃庭 (Yueting Weng)
//  GitHub: https://github.com/Xmax-AI/XmaxSDK-Web
//
//  Copyright (c) 2026 XMAX.AI PTE. LTD.
//

import { XmaxError, XmaxErrorCode } from "../../Foundation/Errors/XmaxError";
import { XmaxLogger } from "../../Foundation/Logging/XmaxLogger";
import type { RealtimeContext } from "../../Service/Realtime/RealtimeContext";
import type { RealtimeExtraParams } from "../../Service/Realtime/RealtimeExtraParams";
import type { RealtimeVideoFormat } from "../../Service/Realtime/RealtimeVideoFormat";
import type { StreamControlling } from "../../Stream/StreamControlling";
import type { RoomEventTargetSize } from "../../Stream/Room/RoomEvent";
import { RealtimeCoordinator } from "./RealtimeCoordinator";
import type { InteractionControlling } from "../../Media/Interaction/InteractionControlling";
import type { RenderControlling } from "../../Render/RenderControlling";

/**
 * The generation canvas, media baseline, and conditions for one request.
 */
interface GenerationOptions {

  /**
   * The fixed local-media format used for interaction coordinates.
   */
  videoFormat: RealtimeVideoFormat;

  /**
   * The generation canvas format; defaults to the local-media format.
   */
  generationVideoFormat?: RealtimeVideoFormat;

  /**
   * Whether the server contains the input within the generation canvas.
   */
  paddingContain?: boolean;

  /**
   * The generation conditions; omission reuses cached conditions.
   */
  context?: RealtimeContext;

  /**
   * The returned dimensions after server generation; omitted when unset.
   */
  targetSize?: RoomEventTargetSize;

  /**
   * Whether to restore the original face; defaults to false.
   */
  faceRestoration?: boolean;

  /**
   * Additional parameters for this signaling message, without caching.
   */
  extraParams?: RealtimeExtraParams;
}

/**
 * Owns tasks and conditions, coordinating generation signaling, confirmation, and cancellation without
 * owning sessions or public state.
 */
export class XmaxRealtimeGenerationManager {

  /**
   * The latest successfully cached generation conditions.
   */
  private currentContext?: RealtimeContext;

  /**
   * The active generation task ID.
   */
  private activeTaskID?: string;

  /**
   * The shared result of concurrent task-stop requests.
   */
  private pendingStop?: {
    taskID: string;
    completion: Promise<void>
  };

  /**
   * Creates a generation manager with transport, interaction, rendering, and task-ID dependencies.
   */
  constructor(
    private readonly streamController: StreamControlling,
    private readonly interactionController: InteractionControlling,
    private readonly renderController: RenderControlling,
    private readonly taskIDGenerator: () => string = XmaxRealtimeGenerationManager.createTaskID,
  ) { }

  /**
   * Validates initial conditions before connecting, allowing later calls to reuse the cache.
   */
  validateContext(
    context?: RealtimeContext
  ): RealtimeContext {
    const resolved = context ?? this.currentContext;
    if (!resolved) {
      throw new XmaxError(
        XmaxErrorCode.invalidConfiguration,
        "A realtime context is required for the first generation"
      );
    }
    return resolved;
  }

  /**
   * Sends generation signaling and waits for confirmation, remote readiness, and audio activation.
   * Caches conditions only after confirmation. Startup failure attempts to stop the task while
   * preserving the original error.
   *
   * @param options.videoFormat - The fixed media format for interaction coordinates.
   * @param options.generationVideoFormat - The model canvas format; defaults to the media format.
   * @param options.paddingContain - Whether the server contains the input within the canvas.
   * @param options.signal - The startup cancellation signal.
   * @param options.ensureCurrent - The operation-validity check.
   * @param options.waitUntilRemoteReady - The remote-stream readiness wait.
   * @param options.context - The generation conditions; omission reuses cached conditions.
   * @param options.restart - Whether to replace the task with a new start message without sending stop;
   * defaults to false.
   * @param options.targetSize - The returned dimensions, omitted when unset.
   * @param options.mirror - Whether start requests horizontal input mirroring; defaults to false.
   * @param options.faceRestoration - Whether to restore the original face; defaults to false.
   * @param options.onStartSent - The optional asynchronous callback after start is sent.
   * @param options.extraParams - Additional uncached start parameters.
   */
  async start(
    options: {
      videoFormat: RealtimeVideoFormat;
      generationVideoFormat?: RealtimeVideoFormat;
      paddingContain?: boolean;
      signal: AbortSignal;
      ensureCurrent: () => void;
      waitUntilRemoteReady: () => Promise<void>;
      context?: RealtimeContext;
      restart?: boolean;
      targetSize?: RoomEventTargetSize;
      mirror?: boolean;
      faceRestoration?: boolean;
      onStartSent?: () => Promise<void>;
      extraParams?: RealtimeExtraParams;
    }
  ): Promise<string> {
    const context = this.validateContext(options.context);
    options.ensureCurrent();

    const taskID = this.taskIDGenerator();
    if (options.restart) {
      this.interactionController.stopInteraction();
      this.renderController.setInteractionEnabled(false);
    }
    this.activeTaskID = taskID;

    try {
      const confirmation = this.streamController.beginGeneration({
        taskID,
        videoFormat: options.generationVideoFormat ?? options.videoFormat,
        paddingContain: options.paddingContain,
        context,
        restart: options.restart,
        ...(options.targetSize && { targetSize: options.targetSize }),
        mirror: options.mirror ?? false,
        faceRestoration: options.faceRestoration ?? false,
        ...(options.onStartSent && { onStartSent: options.onStartSent }),
        extraParams: options.extraParams,
      });
      await this.awaitConfirmation(
        confirmation,
        options.signal
      );
      options.ensureCurrent();
      this.currentContext = context;

      // Enable interaction after static-task confirmation so trajectories can produce the first frame.
      if (options.extraParams?.static_generate !== true) {
        await options.waitUntilRemoteReady();
      }
      options.ensureCurrent();

      await this.streamController.activateRemoteAudio();
      options.ensureCurrent();

      this.interactionController.startInteraction(
        taskID,
        options.videoFormat
      );
      this.renderController.setInteractionEnabled(
        true,
        options.videoFormat
      );
      return taskID;
    } catch (error) {
      await this.stop(taskID);
      throw error;
    }
  }

  /**
   * Updates active-task conditions and replaces cached conditions only after signaling succeeds.
   *
   * @param taskID - The active task ID.
   * @param options.videoFormat - The fixed media format for interaction coordinates.
   * @param options.generationVideoFormat - The model canvas format; defaults to the media format.
   * @param options.paddingContain - Whether the server contains the input within the canvas.
   * @param options.context - The generation conditions; omission reuses cached conditions.
   * @param options.targetSize - The returned dimensions, omitted when unset.
   * @param options.faceRestoration - Whether to restore the original face; defaults to false.
   * @param options.extraParams - Additional uncached change_condition parameters.
   */
  async update(
    taskID: string | undefined,
    options: GenerationOptions
  ): Promise<void> {
    const context = options.context ?? this.currentContext;
    if (!taskID || !context) {
      throw new XmaxError(
        XmaxErrorCode.invalidConfiguration,
        "A realtime context is required to update the current generation"
      );
    }

    await this.streamController.updateGeneration({
      taskID,
      videoFormat: options.generationVideoFormat ?? options.videoFormat,
      paddingContain: options.paddingContain,
      context,
      ...(options.targetSize && { targetSize: options.targetSize }),
      faceRestoration: options.faceRestoration ?? false,
      extraParams: options.extraParams,
    });
    if (this.activeTaskID !== taskID) {
      throw RealtimeCoordinator.cancelledError();
    }
    this.currentContext = context;
    this.interactionController.startInteraction(
      taskID,
      options.videoFormat
    );
    this.renderController.setInteractionEnabled(
      true,
      options.videoFormat
    );
  }

  /**
   * Stops an active task idempotently, sharing concurrent results and logging stop failures.
   */
  async stop(
    taskID = this.activeTaskID
  ): Promise<void> {
    // Cancellation and cleanup share the stop result to avoid duplicate messages or premature room exit.
    if (this.pendingStop && (!taskID || this.pendingStop.taskID === taskID)) {
      return this.pendingStop.completion;
    }
    if (!taskID || this.activeTaskID !== taskID) {
      return;
    }

    this.activeTaskID = undefined;
    this.interactionController.stopInteraction();
    this.renderController.setInteractionEnabled(false);
    const completion = (async () => {
      try {
        await this.streamController.stopGeneration(taskID);
      } catch (error) {
        XmaxLogger.realtime.error(() => `停止生成任务失败 (Failed to Stop Generation Task)\n└─ ${XmaxError.from(error).message}`);
      }
    })();
    this.pendingStop = {
      taskID,
      completion
    };

    try {
      await completion;
    } finally {
      if (this.pendingStop?.completion === completion) {
        this.pendingStop = undefined;
      }
    }
  }

  /**
   * Clears cached conditions and awaits task shutdown for disconnect or close.
   */
  async reset(
    taskID?: string
  ): Promise<void> {
    this.currentContext = undefined;
    this.interactionController.stopInteraction();
    this.renderController.setInteractionEnabled(false);
    // Disconnecting state may omit taskID, but the task owned by this manager must still stop.
    await this.stop(this.activeTaskID ?? (taskID || undefined));
  }

  /**
   * Awaits confirmation, rejecting promptly on cancellation and releasing the abort listener on every
   * path.
   */
  private async awaitConfirmation(
    confirmation: Promise<void>,
    signal: AbortSignal
  ): Promise<void> {
    await new Promise<void>((
      resolve,
      reject
    ) => {
      const cleanup = () => signal.removeEventListener(
        "abort",
        abort
      );
      const abort = () => {
        cleanup();
        reject(RealtimeCoordinator.cancelledError());
      };

      confirmation.then(
        () => {
          cleanup();
          resolve();
        },
        (error) => {
          cleanup();
          reject(error);
        },
      );

      signal.addEventListener(
        "abort",
        abort,
        { once: true }
      );
      if (signal.aborted) {
        abort();
      }
    });
  }

  /**
   * Creates a unique generation task ID.
   */
  private static createTaskID(): string {
    const hex = crypto.randomUUID().replace(
      /-/g,
      ""
    );
    let binary = "";
    for (let index = 0; index < 16; index += 1) {
      binary += String.fromCharCode(parseInt(
        hex.slice(
          index * 2,
          index * 2 + 2
        ),
        16
      ));
    }

    const base64url = btoa(binary)
      .replace(
        /\+/g,
        "-"
      )
      .replace(
        /\//g,
        "_"
      )
      .replace(
        /=+$/,
        ""
      );

    return `task-${base64url}?os=web`;
  }
}
