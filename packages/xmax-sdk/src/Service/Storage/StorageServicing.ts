//
//  StorageServicing.ts
//  XmaxSDK
//
//  Author: 翁跃庭 (Yueting Weng)
//  GitHub: https://github.com/Xmax-AI/XmaxSDK-Web
//
//  Copyright (c) 2026 XMAX.AI PTE. LTD.
//

import type { StoredFile } from "./StoredFile";

/**
 * Options for uploading an image or video.
 */
export interface StorageUploadOptions {

  /**
   * The file bytes. File instances are accepted as Blob values.
   */
  data: Blob | ArrayBuffer | Uint8Array;

  /**
   * The filename used for object keys and default content-type inference.
   */
  fileName: string;

  /**
   * The MIME type; inferred from the filename extension when omitted.
   */
  contentType?: string;

  /**
   * Receives the transferred and total byte counts.
   */
  onProgress?: (
    transferred: number,
    total: number
  ) => void;
}

/**
 * Image/video upload and video download capabilities.
 */
export interface StorageServicing {

  /**
   * Uploads an image directly to object storage using temporary credentials from Xmax.
   *
   * @returns The stored file information.
   * @throws Rejects for invalid options, unavailable credentials, or upload failure.
   */
  uploadImage(
    options: StorageUploadOptions
  ): Promise<StoredFile>;

  /**
   * Uploads an original video directly through COS putObject using temporary credentials. No
   * transcoding, compression, or multipart upload is performed. The ordinary COS upload limit is 5 GB
   * per file.
   *
   * @returns The stored file information.
   * @throws Rejects for invalid options, unavailable credentials, or upload failure.
   */
  uploadVideo(
    options: StorageUploadOptions
  ): Promise<StoredFile>;

  /**
   * Downloads a complete video and requests browser saving; cross-origin URLs must allow CORS.
   *
   * @param options.url - A directly accessible HTTP(S) video URL.
   * @param options.fileName - The suggested saved filename.
   * @param options.signal - The signal cancelling the network download.
   * @returns Completion of the read and browser-save request, not confirmation of a disk write.
   * @throws Rejects for invalid options, a non-browser environment, download failure, or cancellation.
   */
  downloadVideo(
    options: {
      url: string;
      fileName: string;
      signal?: AbortSignal;
    }
  ): Promise<void>;
}
