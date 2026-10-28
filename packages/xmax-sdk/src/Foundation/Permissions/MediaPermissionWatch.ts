//
//  MediaPermissionWatch.ts
//  XmaxSDK
//
//  Author: 翁跃庭 (Yueting Weng)
//  GitHub: https://github.com/Xmax-AI/XmaxSDK-Web
//
//  Copyright (c) 2026 XMAX.AI PTE. LTD.
//

/**
 * An observer of media permission decisions.
 */
export interface MediaPermissionWatch {

  /**
   * Resolves when every observed permission leaves the prompt state.
   */
  readonly decided: Promise<void>;

  /**
   * Removes permission observation; a pending decision no longer resolves afterward.
   */
  dispose(): void;
}

/**
 * The permission-polling interval, in milliseconds. Polling supplements onchange in browsers that do not
 * deliver permission-change events and bounds observation error.
 */
const PERMISSION_POLL_INTERVAL_MS = 100;

/**
 * Observes camera permission and optional microphone permission. Returns an already-resolved observer
 * when all permissions are granted, or waits while any permission is prompt. Denied permissions or
 * unsupported queries return undefined.
 */
export async function watchMediaPermissionPrompt(
  includeMicrophone: boolean,
): Promise<MediaPermissionWatch | undefined> {
  if (typeof navigator === "undefined" || !navigator.permissions?.query) {
    return undefined;
  }

  // Query camera and microphone by runtime capability because their names are absent from some TypeScript DOM libraries.
  const names = ["camera", ...(includeMicrophone ? ["microphone"] : [])];
  const queryOnce = (): Promise<PermissionState[]> =>
    Promise.all(
      names.map(async (name) => {
        const status = await navigator.permissions.query({
          name: name as PermissionName,
        });
        return status.state;
      }),
    );
  const queryStates = (): Promise<PermissionState[]> =>
    Promise.all(
      names.map(async (name) => {
        try {
          const status = await navigator.permissions.query({
            name: name as PermissionName,
          });
          return status.state;
        } catch {
          // Treat a failed polling query as undecided and try again on the next interval.
          return "prompt" as PermissionState;
        }
      }),
    );

  let states: PermissionState[];
  try {
    states = await queryOnce();
  } catch {
    // Unsupported permission queries cannot provide authorization timing.
    return undefined;
  }

  // Already-granted permissions complete immediately; denied permissions do not produce an observer.
  if (states.every((state) => state === "granted")) {
    return {
      decided: Promise.resolve(),

      /**
       * Completes cleanup without work because no observer was allocated.
       */
      dispose() { }
    };
  }
  if (!states.includes("prompt")) {
    return undefined;
  }

  let disposed = false;
  let resolveDecided!: () => void;
  const decided = new Promise<void>((resolve) => {
    resolveDecided = resolve;
  });

  const finishIfDecided = (current: PermissionState[]): void => {
    if (disposed || current.includes("prompt")) {
      return;
    }
    dispose();
    resolveDecided();
  };

  const poll = setInterval(
    () => {
      void queryStates().then(finishIfDecided);
    },
    PERMISSION_POLL_INTERVAL_MS
  );

  /**
   * Stops polling and prevents further permission-change notifications.
   */
  function dispose(): void {
    disposed = true;
    clearInterval(poll);
  }

  return {
    decided,
    dispose
  };
}
