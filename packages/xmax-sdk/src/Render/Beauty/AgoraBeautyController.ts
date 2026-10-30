//
//  AgoraBeautyController.ts
//  XmaxSDK
//
//  Author: 翁跃庭 (Yueting Weng)
//  GitHub: https://github.com/Xmax-AI/XmaxSDK-Web
//
//  Copyright (c) 2026 XMAX.AI PTE. LTD.
//

import type { IAgoraRTC, ILocalVideoTrack } from "agora-rtc-sdk-ng";
import type { IBeautyExtension, IBeautyProcessor } from "agora-extension-beauty-effect";
import { XmaxError, XmaxErrorCode } from "../../Foundation/Errors/XmaxError";
import type { VideoBeautyOptions } from "./VideoBeautyOptions";

/**
 * The extension's documented cleanup method, omitted from its public processor interface.
 */
interface ReleasableBeautyProcessor extends IBeautyProcessor {

  /**
   * Releases the processing worker and generated track.
   */
  release(): Promise<void>;
}

/**
 * The lazily loaded processing runtime; it never creates or joins an RTC client.
 */
interface BeautyRuntime {

  /**
   * The SDK used solely to wrap an existing video track.
   */
  sdk: IAgoraRTC;

  /**
   * The registered beauty extension.
   */
  extension: IBeautyExtension;
}

/**
 * The shared runtime registration, retried after loading failures.
 */
let runtime: Promise<BeautyRuntime> | undefined;

/**
 * Loads beauty dependencies only when an effect is requested.
 */
function loadRuntime(): Promise<BeautyRuntime> {
  runtime ??= Promise.all([
    import("agora-rtc-sdk-ng"),
    import("agora-extension-beauty-effect"),
  ]).then(([agora, beauty]) => {
    const sdk = agora.default;
    const extension = new beauty.default();
    sdk.registerExtensions([extension]);
    return { sdk, extension };
  }).catch(error => {
    runtime = undefined;
    throw error;
  });
  return runtime;
}

/**
 * Validates and snapshots view-specific strengths before changing active processing.
 */
export function resolvedBeautyOptions(
  options: VideoBeautyOptions
): Readonly<Required<VideoBeautyOptions>> {
  const resolved = {
    smoothness: options.smoothness ?? 0.3,
    lightening: options.lightening ?? 0.2,
    sharpness: options.sharpness ?? 0.2,
    redness: options.redness ?? 0.1,
  };
  if (Object.values(resolved).some(value => !Number.isFinite(value) || value < 0 || value > 1)) {
    throw new XmaxError(
      XmaxErrorCode.invalidConfiguration,
      "Beauty strengths must be finite numbers from 0 to 1"
    );
  }
  return Object.freeze(resolved);
}

/**
 * Processes a borrowed result track for display, owning only a clone and its generated output. The
 * wrapped track is never published, so processing is independent of the session's RTC provider.
 */
export class AgoraBeautyController {

  /**
   * Receives the processor's owned display track.
   */
  private readonly onOutput: (
    track: MediaStreamTrack
  ) => void;

  /**
   * Reports processing overload without terminating the received stream.
   */
  private readonly onError: (
    error: XmaxError
  ) => void;

  /**
   * Loads or supplies the processing runtime.
   */
  private readonly load: () => Promise<BeautyRuntime>;

  /**
   * The unpublished wrapper owning a clone of the input track.
   */
  private source?: ILocalVideoTrack;

  /**
   * The active extension processor.
   */
  private processor?: ReleasableBeautyProcessor;

  /**
   * The latest strengths, including updates received during lazy loading.
   */
  private options = resolvedBeautyOptions({});

  /**
   * The extension-generated display track.
   */
  private output?: MediaStreamTrack;

  /**
   * Whether cleanup has invalidated pending loading or output.
   */
  private disposed = false;

  /**
   * The first processed output deadline.
   */
  private timer?: ReturnType<typeof setTimeout>;

  /**
   * Cancels the first-output wait during cleanup.
   */
  private cancelReady?: () => void;

  /**
   * Creates processing callbacks and an injectable runtime loader.
   */
  constructor(
    onOutput: (
      track: MediaStreamTrack
    ) => void,
    onError: (
      error: XmaxError
    ) => void,
    load: () => Promise<BeautyRuntime> = loadRuntime,
  ) {
    this.onOutput = onOutput;
    this.onError = onError;
    this.load = load;
  }

  /**
   * Starts processing an existing video track, rejecting unsupported devices or a missing processed
   * output after five seconds. The caller retains the input track.
   */
  async start(
    track: MediaStreamTrack,
    options: VideoBeautyOptions
  ): Promise<void> {
    this.update(options);
    const { sdk, extension } = await this.load();
    if (this.disposed) {
      return;
    }

    const clone = track.clone();
    try {
      this.source = sdk.createCustomVideoTrack({ mediaStreamTrack: clone });
    } catch (error) {
      clone.stop();
      throw error;
    }
    const processor = extension.createProcessor() as ReleasableBeautyProcessor;
    this.processor = processor;
    this.update(this.options);
    processor.onoverload = () => this.onError(new XmaxError(
      XmaxErrorCode.mediaError,
      "Beauty processing overloaded this device; the original video has been restored"
    ));

    const ready = new Promise<void>((resolve, reject) => {
      this.cancelReady = () => reject(new XmaxError(
        XmaxErrorCode.cancelled,
        "Beauty processing was stopped"
      ));
      this.timer = setTimeout(() => reject(new XmaxError(
        XmaxErrorCode.timeout,
        "Beauty processing did not produce a video track"
      )), 5000);

      // Consume processed output without replacing or stopping the session's original remote track.
      const destination: Parameters<IBeautyProcessor["pipe"]>[0] = {
        name: "XmaxBeautyOutput",
        ID: "xmax-beauty-output",
        kind: "video",
        enabled: true,
        on: () => {},
        off: () => {},
        enable: () => {},
        disable: () => {},
        reset: () => {},
        unpipe: () => {},
        pipe: next => next,
        updateInput: input => {
          const output = input.track;
          if (!output || output === clone) {
            return;
          }
          if (this.disposed) {
            output.stop();
            return;
          }
          clearTimeout(this.timer);
          this.output = output;
          this.onOutput(output);
          resolve();
        },
      };
      this.source!.pipe(processor).pipe(destination);
    });
    // Output can fail or be cancelled while the extension's enable operation is still pending.
    void ready.catch(() => {});
    try {
      await processor.enable();
      await ready;
    } finally {
      clearTimeout(this.timer);
      this.cancelReady = undefined;
    }
  }

  /**
   * Updates strengths without replacing the current processor or display track.
   */
  update(
    options: VideoBeautyOptions
  ): void {
    const values = resolvedBeautyOptions(options);
    this.options = values;
    this.processor?.setOptions({
      lighteningContrastLevel: 1,
      lighteningLevel: values.lightening,
      smoothnessLevel: values.smoothness,
      sharpnessLevel: values.sharpness,
      rednessLevel: values.redness,
    });
  }

  /**
   * Invalidates late output and releases the worker, wrapper, and owned tracks without stopping input.
   */
  async dispose(): Promise<void> {
    if (this.disposed) {
      return;
    }
    this.disposed = true;
    clearTimeout(this.timer);
    this.cancelReady?.();
    let failure: unknown;
    for (const release of [
      () => this.source?.unpipe(),
      () => this.processor?.unpipe(),
      () => this.source?.close(),
      () => this.output?.stop(),
      () => this.processor?.release(),
    ]) {
      try {
        await release();
      } catch (error) {
        failure ??= error;
      }
    }
    if (failure) {
      throw failure;
    }
  }
}
