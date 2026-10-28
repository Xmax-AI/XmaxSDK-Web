//
//  StoredFile.ts
//  XmaxSDK
//
//  Author: 翁跃庭 (Yueting Weng)
//  GitHub: https://github.com/Xmax-AI/XmaxSDK-Web
//
//  Copyright (c) 2026 XMAX.AI PTE. LTD.
//

/**
 * Information returned after a successful file upload.
 */
export class StoredFile {

  /**
   * The URL used to access the file.
   */
  readonly url: string;

  /**
   * The key identifying the object in storage.
   */
  readonly objectKey: string;

  /**
   * The storage ETag, when returned.
   */
  readonly etag?: string;

  /**
   * Creates stored-file information.
   */
  constructor(
    init: {
      url: string;
      objectKey: string;
      etag?: string
    }
  ) {
    this.url = init.url;
    this.objectKey = init.objectKey;
    this.etag = init.etag;
  }
}
