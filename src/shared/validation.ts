import type { DebugState, LoadedSkipState, PlaybackSnapshot, SeekObservation, SkipFile, SkipRange, SkipState } from "./contracts.ts";

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

export function readObject(value: unknown): Record<string, unknown> {
  if (!isObject(value)) throw new Error("Expected a message object.");
  return value;
}

export function readString(value: unknown): string {
  if (typeof value !== "string") throw new Error("Expected text in the message.");
  return value;
}

export function readBoolean(value: unknown): boolean {
  if (typeof value !== "boolean") throw new Error("Expected a boolean in the message.");
  return value;
}

function readSeconds(value: unknown): number {
  if (typeof value !== "number" || !Number.isFinite(value) || value < 0) throw new Error("Expected a non-negative, finite time.");
  return value;
}

function readError(value: unknown): string | null {
  return value === null ? null : readString(value);
}

function parseRange(value: unknown): SkipRange {
  const range = readObject(value);
  const startSeconds = readSeconds(range.startSeconds);
  const endSeconds = readSeconds(range.endSeconds);
  if (endSeconds <= startSeconds) throw new Error("A skip range must end after its start.");
  return { startSeconds, endSeconds, reason: readString(range.reason) };
}

function parseFile(value: unknown): SkipFile {
  const file = readObject(value);
  const filename = readString(file.filename);
  if (!filename.trim()) throw new Error("A skip file needs a filename.");
  if (!Array.isArray(file.ranges) || file.ranges.length === 0) throw new Error("A skip file needs at least one range.");
  const ranges: unknown[] = file.ranges;
  return { filename, ranges: ranges.map(parseRange) };
}

export function parseLoadedSkipState(value: unknown): LoadedSkipState {
  const state = readObject(value);
  return { file: parseFile(state.file), enabled: readBoolean(state.enabled), error: readError(state.error) };
}

export function parseSkipState(value: unknown): SkipState {
  const state = readObject(value);
  if (state.file !== null) return parseLoadedSkipState(state);
  if (state.enabled !== false || state.error !== null) throw new Error("An empty session cannot be enabled or contain a file error.");
  return { file: null, enabled: false, error: null };
}

export function parseDebugState(value: unknown): DebugState {
  const state = readObject(value);
  const options = readObject(state.options);
  return { options: { showTimestamp: readBoolean(options.showTimestamp), showSkipRanges: readBoolean(options.showSkipRanges) }, error: readError(state.error) };
}

export function parsePlayback(value: unknown): PlaybackSnapshot {
  const playback = readObject(value);
  const durationSeconds = readSeconds(playback.durationSeconds);
  if (durationSeconds === 0) throw new Error("Video duration must be positive.");
  return { currentSeconds: readSeconds(playback.currentSeconds), durationSeconds, paused: readBoolean(playback.paused), ended: readBoolean(playback.ended) };
}

export function parseSeekObservation(value: unknown): SeekObservation {
  const observation = readObject(value);
  return { requestedSeconds: readSeconds(observation.requestedSeconds), observedSeconds: readSeconds(observation.observedSeconds) };
}
