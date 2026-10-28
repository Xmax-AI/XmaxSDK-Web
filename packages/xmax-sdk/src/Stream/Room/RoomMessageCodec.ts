//
//  RoomMessageCodec.ts
//  XmaxSDK
//
//  Author: 翁跃庭 (Yueting Weng)
//  GitHub: https://github.com/Xmax-AI/XmaxSDK-Web
//
//  Copyright (c) 2026 XMAX.AI PTE. LTD.
//

import { XmaxLogger } from "../../Foundation/Logging/XmaxLogger";

/**
 * The default fragment event name.
 */
const CHUNK_EVENT = "__trtc_chunk__";

/**
 * An incomplete message being reassembled.
 */
interface ChunkRecord {

  /**
   * The expected number of fragments.
   */
  count: number;

  /**
   * Message fragments indexed by their sequence number.
   */
  parts: Map<number, string>;
}

/**
 * Encodes room text messages and reassembles incoming fragments.
 *
 * TRTC and Agora fragment messages exceeding 800 UTF-8 bytes; VeRTC sends them unchanged. Incoming
 * fragments are grouped by sender and event ID, may arrive out of order, and produce a parsed business
 * message only when complete.
 */
export class RoomMessageCodec {

  /**
   * The message size, in bytes, above which fragmentation is used.
   */
  static readonly chunkThresholdBytes = 800;

  /**
   * The fragment data budget, in bytes, leaving room for the JSON envelope.
   */
  static readonly chunkDataBudgetBytes = 600;

  /**
   * The maximum number of cached incomplete messages.
   */
  static readonly cacheLimit = 1000;

  /**
   * Incomplete messages indexed by sender and event ID.
   */
  private readonly records = new Map<string, ChunkRecord>();

  /**
   * Creates a message codec.
   *
   * @param chunkEvent - The fragment event name; TRTC uses the default, Agora uses __agora_chunk__, and
   * null disables fragmentation.
   */
  constructor(
    private readonly chunkEvent: string | null = CHUNK_EVENT
  ) { }

  /**
   * Encodes an outgoing message.
   *
   * @returns The original message as a single item when fragmentation is unnecessary; otherwise, JSON
   * fragments using the selected provider's protocol.
   */
  encodeOutgoing(
    message: string
  ): string[] {
    if (this.chunkEvent === null || RoomMessageCodec.byteLength(message) <= RoomMessageCodec.chunkThresholdBytes) {
      return [message];
    }

    const eventId = RoomMessageCodec.makeEventId();
    const slices = RoomMessageCodec.sliceByByteBudget(
      message,
      RoomMessageCodec.chunkDataBudgetBytes,
    );
    const count = slices.length;

    XmaxLogger.room.debug(
      () =>
        `房间消息拆包 (Chunking Room Message)\n` +
        `└─ eventId: ${eventId} · count: ${count} · bytes: ${RoomMessageCodec.byteLength(message)}`,
    );

    return slices.map((
      data,
      index
    ) =>
      JSON.stringify({
        event: this.chunkEvent,
        eventId,
        index,
        count,
        data,
      }),
    );
  }

  /**
   * Processes an incoming message.
   *
   * @returns A parsed business message, or undefined for invalid JSON or incomplete fragments. Completed
   * fragment records are removed before parsing.
   */
  processIncoming(
    senderUserID: string,
    message: string
  ): unknown {
    let parsed: unknown;
    try {
      parsed = JSON.parse(message);
    } catch {
      XmaxLogger.room.warning(() => "房间消息不是合法 JSON (Room Message Is Not Valid JSON)");
      return undefined;
    }

    const chunk = this.parseChunk(parsed);
    if (!chunk) {
      return parsed;
    }

    const key = `${senderUserID}:${chunk.eventId}`;
    let record = this.records.get(key);
    if (!record) {
      record = {
        count: chunk.count,
        parts: new Map()
      };
      this.records.set(
        key,
        record
      );
      this.evictOverflow();
    }

    record.parts.set(
      chunk.index,
      chunk.data
    );

    if (record.parts.size < record.count) {
      return undefined;
    }

    this.records.delete(key);
    const parts: string[] = [];
    for (let index = 0; index < record.count; index += 1) {
      const part = record.parts.get(index);
      if (part === undefined) {
        return undefined;
      }
      parts.push(part);
    }

    const joined = parts.join("");
    try {
      return JSON.parse(joined) as unknown;
    } catch {
      XmaxLogger.room.warning(
        () => `房间消息组包后不是合法 JSON (Reassembled Message Is Not Valid JSON)\n└─ eventId: ${chunk.eventId}`,
      );
      return undefined;
    }
  }

  /**
   * Clears all incomplete messages.
   */
  reset(): void {
    this.records.clear();
  }

  /**
   * Recognizes a fragment envelope; incomplete envelope fields are treated as a regular business
   * message.
   */
  private parseChunk(
    parsed: unknown,
  ): {
    eventId: string;
    index: number;
    count: number;
    data: string
  } | undefined {
    if (this.chunkEvent === null || typeof parsed !== "object" || parsed === null) {
      return undefined;
    }

    const record = parsed as Record<string, unknown>;
    if (
      record.event !== this.chunkEvent ||
      typeof record.eventId !== "string" ||
      record.eventId.length === 0 ||
      !Number.isInteger(record.index) ||
      !Number.isInteger(record.count) ||
      typeof record.data !== "string"
    ) {
      return undefined;
    }

    const index = record.index as number;
    const count = record.count as number;
    if (count < 1 || index < 0 || index >= count) {
      return undefined;
    }

    return {
      eventId: record.eventId,
      index,
      count,
      data: record.data
    };
  }

  /**
   * Evicts the oldest incomplete messages until the cache is within its limit.
   */
  private evictOverflow(): void {
    while (this.records.size > RoomMessageCodec.cacheLimit) {
      const oldest = this.records.keys().next().value;
      if (oldest === undefined) {
        return;
      }
      this.records.delete(oldest);
    }
  }

  /**
   * Splits a string by its UTF-8 byte budget without splitting multibyte characters.
   */
  private static sliceByByteBudget(
    message: string,
    budget: number
  ): string[] {
    const slices: string[] = [];
    let current = "";
    let currentBytes = 0;

    for (const char of message) {
      // The JSON data field must include the escaping cost of quotes, backslashes, and control characters.
      const bytes = RoomMessageCodec.byteLength(JSON.stringify(char)) - 2;
      if (currentBytes + bytes > budget && current.length > 0) {
        slices.push(current);
        current = "";
        currentBytes = 0;
      }
      current += char;
      currentBytes += bytes;
    }

    if (current.length > 0) {
      slices.push(current);
    }

    return slices;
  }

  /**
   * Returns the UTF-8 byte length of a string.
   */
  private static byteLength(
    value: string
  ): number {
    return new TextEncoder().encode(value).byteLength;
  }

  /**
   * Creates a 32-character hexadecimal fragment event identifier.
   */
  private static makeEventId(): string {
    if (typeof crypto !== "undefined" && crypto.randomUUID) {
      return crypto.randomUUID().replace(
        /-/g,
        ""
      );
    }
    return Array.from(
      { length: 32 },
      () =>
        Math.floor(Math.random() * 16).toString(16),
    ).join("");
  }
}
