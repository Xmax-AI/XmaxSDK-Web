//
//  RealtimeExtraParams.ts
//  XmaxSDK
//
//  Author: 翁跃庭 (Yueting Weng)
//  GitHub: https://github.com/Xmax-AI/XmaxSDK-Web
//
//  Copyright (c) 2026 XMAX.AI PTE. LTD.
//

import { XmaxError, XmaxErrorCode } from "../../Foundation/Errors/XmaxError";

/**
 * JSON data accepted by generation signaling.
 */
export type JsonValue = string | number | boolean | null | JsonValue[] | {
  [key: string]: JsonValue
};

/**
 * Parameters merged into this start or change_condition message. Values are not cached and must not
 * override SDK-managed fields.
 */
export type RealtimeExtraParams = Record<string, JsonValue>;

/**
 * Generation fields reserved for XmaxSDK.
 */
const RESERVED_PARAMS = new Set([
  "model", "face_replace", "size", "target_size", "prompt", "ref_image_path",
  "mirror", "min_bitrate", "max_bitrate", "padding",
]);

/**
 * Validates and copies parameters without caching them in the generation context.
 *
 * @param params - Additional JSON parameters for this call.
 * @returns An independent JSON snapshot, or undefined if no parameters were supplied.
 * @throws An invalidConfiguration error for non-JSON values, cycles, or reserved fields.
 */
export function snapshotExtraParams(
  params?: RealtimeExtraParams
): RealtimeExtraParams | undefined {
  if (params === undefined) {
    return undefined;
  }
  const invalid = (message: string): never => {
    throw new XmaxError(
      XmaxErrorCode.invalidConfiguration,
      message
    );
  };
  if (!params || typeof params !== "object" || Array.isArray(params)) {
    return invalid("extraParams must be a JSON object");
  }
  for (const key of Object.keys(params)) {
    if (RESERVED_PARAMS.has(key)) {
      return invalid(`extraParams conflicts with SDK parameter: ${key}`);
    }
  }
  const ancestors = new Set<object>();
  const validate = (value: unknown): void => {
    if (value === null || typeof value === "string" || typeof value === "boolean") {
      return;
    }
    if (typeof value === "number" && Number.isFinite(value)) {
      return;
    }
    if (typeof value !== "object" || !value) {
      return invalid("extraParams must contain only JSON values");
    }
    if (ancestors.has(value)) {
      return invalid("extraParams must not contain circular references");
    }
    const prototype = Object.getPrototypeOf(value);
    if (!Array.isArray(value) && prototype !== Object.prototype && prototype !== null) {
      return invalid("extraParams must contain only JSON objects and arrays");
    }
    if (Object.getOwnPropertySymbols(value).length) {
      return invalid("extraParams must not contain symbol keys");
    }
    ancestors.add(value);
    for (const child of Array.isArray(value) ? value : Object.values(value)) {
      validate(child);
    }
    ancestors.delete(value);
  };
  validate(params);
  return JSON.parse(JSON.stringify(params)) as RealtimeExtraParams;
}
