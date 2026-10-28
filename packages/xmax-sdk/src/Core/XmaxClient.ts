//
//  XmaxClient.ts
//  XmaxSDK
//
//  Author: 翁跃庭 (Yueting Weng)
//  GitHub: https://github.com/Xmax-AI/XmaxSDK-Web
//
//  Copyright (c) 2026 XMAX.AI PTE. LTD.
//

import { XmaxLogger } from "../Foundation/Logging/XmaxLogger";
import type { ApiServicing } from "../Service/Network/ApiServicing";
import { ApiService } from "../Service/Network/ApiService";
import type { MediaServicing } from "../Service/Media/MediaServicing";
import { MediaService } from "../Service/Media/MediaService";
import type { StorageServicing } from "../Service/Storage/StorageServicing";
import { StorageService } from "../Service/Storage/StorageService";
import { RealtimeModel, modelBaseURL, type RealtimeModelName } from "../Service/Realtime/RealtimeModel";
import type { RealtimeConfiguration } from "./Realtime/RealtimeConfiguration";
import { XmaxRealtimeManager } from "./Realtime/XmaxRealtimeManager";
import type { XmaxRealtimeManaging } from "./Realtime/XmaxRealtimeManaging";
import { XmaxConfiguration } from "./XmaxConfiguration";
import { apiBaseURL, realtimeApiBaseURL, nonRealtimeApiBaseURL } from "../Foundation/Runtime/XmaxEnvironment";
import { NonRealtimeTaskService } from "../Service/NonRealtime/NonRealtimeTaskService";
import { XmaxNonRealtimeManager } from "./NonRealtime/XmaxNonRealtimeManager";
import type { XmaxNonRealtimeManaging } from "./NonRealtime/XmaxNonRealtimeManaging";

/**
 * The entry point for realtime generation, non-realtime tasks, and media services.
 */
export class XmaxClient {

  /**
   * The configuration shared by this client's services.
   */
  readonly configuration: XmaxConfiguration;

  /**
   * The API service used for authenticated server requests.
   */
  private readonly apiService: ApiServicing;

  /**
   * Creates an XmaxSDK client.
   *
   * Local camera preview does not require a validated API key. Server operations validate the key when
   * called.
   */
  constructor(
    configuration: XmaxConfiguration
  ) {
    this.configuration = configuration;
    XmaxLogger.configure(
      configuration.loggerOptions,
      configuration.environment,
    );
    this.apiService = new ApiService({
      apiKey: configuration.apiKey,
      baseURL: apiBaseURL(configuration.environment),
    });
  }

  /**
   * Creates a realtime media manager.
   *
   * Built-in models use the environment's realtime endpoint. Custom model IDs use the development
   * endpoint for the entire session lifecycle.
   *
   * @param options - The model and realtime generation configuration.
   * @returns A manager for local preview, realtime connections, and generation.
   */
  createRealtimeManager(
    options: RealtimeConfiguration
  ): XmaxRealtimeManaging {
    const baseURL = modelBaseURL(options.model) ?? realtimeApiBaseURL(this.configuration.environment);
    const apiService = new ApiService({
      apiKey: this.configuration.apiKey,
      baseURL
    });

    return new XmaxRealtimeManager(
      options,
      {
        apiService,
        environment: this.configuration.environment,
      }
    );
  }

  /**
   * Creates a non-realtime task manager using the client's API key and task endpoint.
   *
   * Creation does not send requests or load an RTC SDK. Server-persisted tasks can be queried again by
   * ID.
   */
  createNonRealtimeManager(): XmaxNonRealtimeManaging {
    const apiService = new ApiService({
      apiKey: this.configuration.apiKey,
      baseURL: nonRealtimeApiBaseURL(this.configuration.environment),
    });

    return new XmaxNonRealtimeManager(new NonRealtimeTaskService(apiService));
  }

  /**
   * Creates a media-processing and capability-query service.
   *
   * @param model - The model whose input rules apply; defaults to x2.1.
   */
  createMediaService(
    model: RealtimeModelName = RealtimeModel.x2_1
  ): MediaServicing {
    return new MediaService(model);
  }

  /**
   * Creates a storage service for uploading images and videos.
   */
  createStorageService(): StorageServicing {
    return new StorageService({ apiService: this.apiService });
  }
}
