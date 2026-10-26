import type { RealtimeMediaFrame } from "@xmaxai/web-sdk";

export type RecordingRequest =
  | { type: "start" }
  | { type: "frame"; id: number; packet: RealtimeMediaFrame }
  | { type: "stop" };

export type RecordingResponse =
  | { type: "ready" }
  | { type: "accepted"; id: number }
  | { type: "limit" }
  | { type: "complete"; blob: Blob; extension: "mp4" | "webm" }
  | { type: "error"; message: string };

export interface RecordingResult {
  blob: Blob;
  fileName: string;
}
