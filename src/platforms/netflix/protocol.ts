import type { PlaybackSnapshot, Reply, SeekObservation } from "../../shared/contracts.ts";

export const NETFLIX_PLAYER_CHANNEL = "scene-skip.netflix.player";

export type NetflixPlayerCommand =
  | { operation: "read"; contentId: string }
  | { operation: "seek"; contentId: string; seconds: number };

export interface NetflixPlayerRequest {
  channel: typeof NETFLIX_PLAYER_CHANNEL;
  direction: "request";
  requestId: string;
  command: NetflixPlayerCommand;
}

export interface NetflixPlayerResponse {
  channel: typeof NETFLIX_PLAYER_CHANNEL;
  direction: "response";
  requestId: string;
  reply: Reply<PlaybackSnapshot | SeekObservation>;
}

export function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

export function readPlayerCommand(value: unknown): NetflixPlayerCommand {
  if (!isRecord(value) || typeof value.contentId !== "string" || !/^\d+$/.test(value.contentId)) {
    throw new Error("Netflix player command requires a valid content ID.");
  }
  switch (value.operation) {
    case "read": return { operation: "read", contentId: value.contentId };
    case "seek":
      if (typeof value.seconds !== "number" || !Number.isFinite(value.seconds) || value.seconds < 0) {
        throw new Error("Netflix seek target must be a non-negative finite number.");
      }
      return { operation: "seek", contentId: value.contentId, seconds: value.seconds };
    default: throw new Error("Unsupported Netflix player operation.");
  }
}

export function readPlayerReply<T>(value: unknown, readData: (value: unknown) => T): T {
  if (!isRecord(value) || typeof value.ok !== "boolean") throw new Error("Netflix returned an invalid player reply.");
  if (!value.ok) {
    if (!isRecord(value.error)
      || (value.error.code !== "REQUEST_FAILED" && value.error.code !== "SEEK_FAILED" && value.error.code !== "NOT_IMPLEMENTED")
      || typeof value.error.message !== "string") {
      throw new Error("Netflix returned an invalid error reply.");
    }
    throw new Error(value.error.message);
  }
  return readData(value.data);
}
