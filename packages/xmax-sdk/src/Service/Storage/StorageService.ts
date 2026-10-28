//
//  StorageService.ts
//  XmaxSDK
//
//  Author: 翁跃庭 (Yueting Weng)
//  GitHub: https://github.com/Xmax-AI/XmaxSDK-Web
//
//  Copyright (c) 2026 XMAX.AI PTE. LTD.
//

import { XmaxError, XmaxErrorCode } from "../../Foundation/Errors/XmaxError";
import { XmaxLogger } from "../../Foundation/Logging/XmaxLogger";
import type { ApiServicing } from "../Network/ApiServicing";
import { StoredFile } from "./StoredFile";
import type { StorageServicing, StorageUploadOptions } from "./StorageServicing";

/**
 * Temporary object-storage settings returned by /cos/sts.
 */
interface TemporaryStoragePayload {

  /**
   * The object-storage bucket.
   */
  bucket?: string;

  /**
   * The bucket's region.
   */
  region?: string;

  /**
   * The object-storage endpoint.
   */
  endpoint?: string;

  /**
   * The prefix for uploaded object keys.
   */
  prefix?: string;

  /**
   * Temporary object-storage authentication credentials.
   */
  credentials?: {
    accessKeyId?: string;
    secretAccessKey?: string;
    sessionToken?: string;
  };
}

/**
 * Validated temporary object-storage configuration.
 */
interface TemporaryStorageConfiguration {

  /**
   * The object-storage bucket.
   */
  bucket: string;

  /**
   * The bucket's region.
   */
  region: string;

  /**
   * The object-storage endpoint.
   */
  endpoint?: string;

  /**
   * The prefix for uploaded object keys.
   */
  prefix: string;

  /**
   * Temporary object-storage authentication credentials.
   */
  credentials: {
    accessKeyID: string;
    secretAccessKey: string;
    sessionToken: string;
  };
}

/**
 * The minimum client capabilities required for direct object uploads.
 */
export interface StorageObjectClient {

  /**
   * Uploads to a bucket and object key, reporting errors or the object URL through a callback and
   * optionally reporting progress.
   */
  putObject(
    params: {
      Bucket: string;
      Region: string;
      Key: string;
      Body: Blob;
      ContentType: string;
      onProgress?: (
        info: {
          loaded: number;
          total: number
        }
      ) => void;
    },
    callback: (
      error: {
        message?: string
      } | null,
      data?: {
        Location?: string;
        ETag?: string
      },
    ) => void,
  ): void;
}

/**
 * Creates an object-storage client from temporary credentials.
 */
export type StorageObjectClientFactory = (
  configuration: TemporaryStorageConfiguration,
) => Promise<StorageObjectClient>;

/**
 * API and client dependencies for object-storage uploads.
 */
export interface StorageServiceOptions {

  /**
   * The Xmax API request service.
   */
  apiService: ApiServicing;

  /**
   * The replaceable object-storage client factory.
   */
  clientFactory?: StorageObjectClientFactory;

  /**
   * The replaceable clock used for object keys.
   */
  dateGenerator?: () => Date;

  /**
   * The replaceable unique-ID source.
   */
  identifierGenerator?: () => string;
}

/**
 * Content types indexed by filename extension.
 */
const CONTENT_TYPES: Record<string, string> = {
  jpg: "image/jpeg",
  jpeg: "image/jpeg",
  png: "image/png",
  webp: "image/webp",
  gif: "image/gif",
  bmp: "image/bmp",
  heic: "image/heic",
  heif: "image/heif",
  mp4: "video/mp4",
  m4v: "video/mp4",
  mov: "video/quicktime",
  webm: "video/webm",
  avi: "video/x-msvideo",
  mkv: "video/x-matroska",
  ogv: "video/ogg",
};

/**
 * Uploads files directly to object storage and downloads videos.
 *
 * Uploads obtain temporary credentials through GET /cos/sts, then send file bytes directly to COS. URLs
 * prefer the returned Location, followed by a custom endpoint or the default COS domain.
 */
export class StorageService implements StorageServicing {

  /**
   * The API service used to obtain temporary storage credentials.
   */
  private readonly apiService: ApiServicing;

  /**
   * The factory creating an object-storage client.
   */
  private readonly clientFactory: StorageObjectClientFactory;

  /**
   * The clock used in uploaded object keys.
   */
  private readonly dateGenerator: () => Date;

  /**
   * The unique-ID source used in uploaded object keys.
   */
  private readonly identifierGenerator: () => string;

  /**
   * Creates a storage service.
   */
  constructor(
    options: StorageServiceOptions
  ) {
    this.apiService = options.apiService;
    this.clientFactory = options.clientFactory ?? StorageService.cosClientFactory;
    this.dateGenerator = options.dateGenerator ?? (() => new Date());
    this.identifierGenerator =
      options.identifierGenerator ?? (() => crypto.randomUUID().toLowerCase());
  }

  /**
   * Uploads an image and returns its access information.
   */
  async uploadImage(
    options: StorageUploadOptions
  ): Promise<StoredFile> {
    return this.upload(
      options,
      "Image"
    );
  }

  /**
   * Uploads an original video without transcoding, compression, or multipart upload.
   */
  async uploadVideo(
    options: StorageUploadOptions
  ): Promise<StoredFile> {
    return this.upload(
      options,
      "Video"
    );
  }

  /**
   * Downloads an original video and requests browser saving, with cancellable network transfer.
   */
  async downloadVideo(
    options: Parameters<StorageServicing["downloadVideo"]>[0]
  ): Promise<void> {
    const fileName = StorageService.validateFileName(options.fileName);
    let url: URL;
    try {
      url = new URL(options.url.trim());
    } catch {
      throw new XmaxError(
        XmaxErrorCode.invalidConfiguration,
        "Invalid video download URL"
      );
    }
    if (!["http:", "https:"].includes(url.protocol) || url.username || url.password) {
      throw new XmaxError(
        XmaxErrorCode.invalidConfiguration,
        "Video download requires an HTTP(S) URL without embedded credentials"
      );
    }
    if (typeof document === "undefined" || !document.body) {
      throw new XmaxError(
        XmaxErrorCode.invalidConfiguration,
        "Video saving requires a browser document"
      );
    }

    let objectURL: string | undefined;
    let link: HTMLAnchorElement | undefined;
    let saveRequested = false;
    try {
      if (options.signal?.aborted) {
        throw new XmaxError(
          XmaxErrorCode.cancelled,
          "Video download was cancelled"
        );
      }

      // Fetch the resource directly without sending the SDK API key or cookies.
      const response = await fetch(
        options.url.trim(),
        {
          credentials: "omit",
          signal: options.signal
        }
      );
      if (!response.ok) {
        throw new XmaxError(
          XmaxErrorCode.downloadError,
          "Video download failed",
          { httpStatus: response.status }
        );
      }
      const data = await response.blob();
      if (options.signal?.aborted) {
        throw new XmaxError(
          XmaxErrorCode.cancelled,
          "Video download was cancelled"
        );
      }
      if (data.size === 0) {
        throw new XmaxError(
          XmaxErrorCode.downloadError,
          "Downloaded video is empty"
        );
      }

      // Use a local Blob URL to suggest a filename for a cross-origin resource.
      objectURL = URL.createObjectURL(data);
      link = document.createElement("a");
      link.href = objectURL;
      link.download = fileName;
      link.hidden = true;
      document.body.appendChild(link);
      link.click();
      saveRequested = true;
    } catch (error) {
      if (options.signal?.aborted) {
        throw new XmaxError(
          XmaxErrorCode.cancelled,
          "Video download was cancelled"
        );
      }
      if (error instanceof XmaxError) {
        throw error;
      }
      throw new XmaxError(
        XmaxErrorCode.downloadError,
        error instanceof Error ? error.message : String(error)
      );
    } finally {
      link?.remove();
      if (objectURL) {
        const resourceURL = objectURL;
        if (saveRequested) {
          // Allow the browser to take over the download before releasing the Blob URL.
          setTimeout(
            () => URL.revokeObjectURL(resourceURL),
            60_000
          );
        } else {
          URL.revokeObjectURL(resourceURL);
        }
      }
    }
  }

  /**
   * Obtains temporary credentials and uploads through COS putObject, normalizing progress, results, and
   * errors.
   */
  private async upload(
    options: StorageUploadOptions,
    mediaType: "Image" | "Video"
  ): Promise<StoredFile> {
    const startedAt = Date.now();
    try {
      const safeName = StorageService.validateFileName(options.fileName);
      const contentType =
        options.contentType?.trim() || StorageService.inferContentType(safeName);
      const body = StorageService.makeBody(
        options.data,
        contentType
      );
      if (body.size === 0) {
        throw new XmaxError(
          XmaxErrorCode.invalidConfiguration,
          `${mediaType} data cannot be empty`,
        );
      }

      const temporary = await this.fetchStorageConfiguration();
      const objectKey = this.makeObjectKey(
        temporary.prefix,
        safeName
      );
      const client = await this.clientFactory(temporary);

      XmaxLogger.storage.info(
        () =>
          `开始上传 (Upload Started)\n` +
          `├─ ${XmaxLogger.localized("文件：", "File: ")}${safeName}\n` +
          `└─ ${XmaxLogger.localized("大小：", "Size: ")}${StorageService.formatByteCount(body.size)}`,
      );

      const uploaded = await StorageService.putObject(
        client,
        {
          Bucket: temporary.bucket,
          Region: temporary.region,
          Key: objectKey,
          Body: body,
          ContentType: contentType,
          onProgress: options.onProgress
            ? (info) => options.onProgress?.(
              info.loaded,
              info.total
            )
            : undefined,
        }
      );

      const url = StorageService.resolveObjectURL(
        uploaded.Location,
        temporary,
        objectKey,
      );
      XmaxLogger.storage.info(
        () =>
          `上传完成 (Upload Completed)\n` +
          `├─ ${XmaxLogger.localized("地址：", "URL: ")}${url}\n` +
          `└─ ${XmaxLogger.localized("耗时：", "Duration: ")}${Date.now() - startedAt}ms`,
      );
      return new StoredFile({
        url,
        objectKey,
        etag: uploaded.ETag
      });
    } catch (error) {
      if (error instanceof XmaxError) {
        throw error;
      }
      throw new XmaxError(
        XmaxErrorCode.uploadError,
        error instanceof Error && error.message.trim().length > 0
          ? error.message.trim()
          : String(error),
      );
    }
  }

  /**
   * Returns temporary storage settings, rejecting incomplete credentials with an API error.
   */
  private async fetchStorageConfiguration(): Promise<TemporaryStorageConfiguration> {
    const payload = await this.apiService.get<TemporaryStoragePayload>("/cos/sts");

    const message = "Invalid storage credential payload";
    const bucket = StorageService.nonEmpty(payload.bucket);
    const region = StorageService.nonEmpty(payload.region);
    const prefix = StorageService.nonEmpty(payload.prefix);
    const accessKeyID = StorageService.nonEmpty(payload.credentials?.accessKeyId);
    const secretAccessKey = StorageService.nonEmpty(payload.credentials?.secretAccessKey);
    const sessionToken = StorageService.nonEmpty(payload.credentials?.sessionToken);
    if (!bucket || !region || !prefix || !accessKeyID || !secretAccessKey || !sessionToken) {
      throw new XmaxError(
        XmaxErrorCode.apiError,
        message
      );
    }

    return {
      bucket,
      region,
      endpoint: StorageService.nonEmpty(payload.endpoint),
      prefix,
      credentials: {
        accessKeyID,
        secretAccessKey,
        sessionToken
      },
    };
  }

  /**
   * Builds an object key from its prefix, millisecond timestamp, unique ID, and filename.
   */
  private makeObjectKey(
    prefix: string,
    fileName: string
  ): string {
    const milliseconds = Math.round(this.dateGenerator().getTime());
    return `${prefix}${milliseconds}_${this.identifierGenerator()}_${fileName}`;
  }

  /**
   * Dynamically loads cos-js-sdk-v5 and creates a client with temporary credentials.
   */
  private static async cosClientFactory(
    configuration: TemporaryStorageConfiguration,
  ): Promise<StorageObjectClient> {
    const module = await import("cos-js-sdk-v5");
    const COS = module.default;
    return new COS({
      SecretId: configuration.credentials.accessKeyID,
      SecretKey: configuration.credentials.secretAccessKey,
      SecurityToken: configuration.credentials.sessionToken,
    }) as unknown as StorageObjectClient;
  }

  /**
   * Wraps object upload callbacks in a promise.
   */
  private static putObject(
    client: StorageObjectClient,
    params: Parameters<StorageObjectClient["putObject"]>[0],
  ): Promise<{
    Location?: string;
    ETag?: string
  }> {
    return new Promise((
      resolve,
      reject
    ) => {
      client.putObject(
        params,
        (
          error,
          data
        ) => {
          if (error) {
            reject(
              new XmaxError(
                XmaxErrorCode.uploadError,
                error.message?.trim() || "Storage upload failed",
              ),
            );
            return;
          }
          resolve(data ?? {});
        }
      );
    });
  }

  /**
   * Resolves the object URL from Location with a scheme, a custom endpoint, or the default COS domain,
   * in that order.
   */
  private static resolveObjectURL(
    location: string | undefined,
    configuration: TemporaryStorageConfiguration,
    objectKey: string,
  ): string {
    const candidate = location?.trim() ?? "";
    if (candidate.startsWith("//")) {
      return `https:${candidate}`;
    }
    if (/^https?:\/\//i.test(candidate)) {
      return candidate;
    }

    const endpoint = configuration.endpoint?.trim();
    if (endpoint) {
      const normalized = /^https?:\/\//i.test(endpoint)
        ? endpoint
        : `https://${endpoint}`;
      return `${normalized.replace(/\/+$/, "")}/${objectKey}`;
    }

    return `https://${configuration.bucket}.cos.${configuration.region}.myqcloud.com/${objectKey}`;
  }

  /**
   * Creates the upload body.
   */
  private static makeBody(
    data: StorageUploadOptions["data"],
    contentType: string,
  ): Blob {
    if (data instanceof Blob) {
      return data;
    }
    const bytes = data instanceof Uint8Array ? data : new Uint8Array(data);
    return new Blob(
      [bytes as unknown as BlobPart],
      { type: contentType }
    );
  }

  /**
   * Validates a nonempty filename without path separators.
   */
  private static validateFileName(
    fileName: string
  ): string {
    const safeName = fileName.trim();
    if (!safeName || safeName.includes("/") || safeName.includes("\\")) {
      throw new XmaxError(
        XmaxErrorCode.invalidConfiguration,
        "Invalid file name for storage operation",
      );
    }
    return safeName;
  }

  /**
   * Infers content type from the filename extension.
   */
  private static inferContentType(
    fileName: string
  ): string {
    const extension = fileName.split(".").pop()?.toLowerCase() ?? "";
    return CONTENT_TYPES[extension] ?? "application/octet-stream";
  }

  /**
   * Formats a byte count for logging.
   */
  private static formatByteCount(
    bytes: number
  ): string {
    if (bytes < 1024) {
      return `${bytes} B`;
    }
    if (bytes < 1024 * 1024) {
      return `${(bytes / 1024).toFixed(1)} KB`;
    }
    return `${(bytes / 1024 / 1024).toFixed(2)} MB`;
  }

  /**
   * Trims an optional string and returns undefined when empty.
   */
  private static nonEmpty(
    value?: string
  ): string | undefined {
    const normalized = value?.trim();
    return normalized || undefined;
  }
}
