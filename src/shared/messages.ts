import type { DebugOptions, DebugState, LoadedSkipState, Platform, PlaybackSnapshot, Reply, SeekObservation, SkipState } from "./contracts.ts";
import { Command } from "./commands.ts";
import { parseDebugState, parseLoadedSkipState, parsePlayback, parseSeekObservation, parseSkipState, readBoolean, readObject, readString } from "./validation.ts";

export interface Target {
  tabId: number;
  platform: Platform;
}

export interface Calls {
  [Command.DebugSeek]: { input: Target & { timestamp: string }; output: SeekObservation };
  [Command.DebugGet]: { input: Target; output: DebugState };
  [Command.DebugConfigure]: { input: Target & { options: DebugOptions }; output: DebugState };
  [Command.SessionGet]: { input: Target; output: PlaybackSnapshot };
  [Command.FileLoad]: { input: Target & { filename: string; text: string }; output: LoadedSkipState };
  [Command.FileGet]: { input: Target; output: SkipState };
  [Command.FileSetEnabled]: { input: Target & { enabled: boolean }; output: LoadedSkipState };
}

export type CommandName = keyof Calls;
export type Request = {
  [K in CommandName]: { type: K; payload: Calls[K]["input"] }
}[CommandName];

export function parseRequest(value: unknown): Request {
  const request = readObject(value);
  const payload = readObject(request.payload);
  if (typeof payload.tabId !== "number" || !Number.isSafeInteger(payload.tabId) || payload.tabId < 0) {
    throw new Error("A valid video tab ID is required.");
  }
  if (payload.platform !== "netflix" && payload.platform !== "prime" && payload.platform !== "youtube") {
    throw new Error("Select a supported platform.");
  }
  const target: Target = { tabId: payload.tabId, platform: payload.platform };
  switch (request.type) {
    case Command.DebugSeek: return { type: request.type, payload: { ...target, timestamp: readString(payload.timestamp) } };
    case Command.DebugGet: return { type: request.type, payload: target };
    case Command.DebugConfigure: {
      const options = readObject(payload.options);
      return { type: request.type, payload: { ...target, options: {
        showTimestamp: readBoolean(options.showTimestamp), showSkipRanges: readBoolean(options.showSkipRanges)
      } } };
    }
    case Command.SessionGet: return { type: request.type, payload: target };
    case Command.FileLoad: {
      const filename = readString(payload.filename);
      if (!filename.trim()) throw new Error("A skip file needs a filename.");
      return { type: request.type, payload: { ...target, filename, text: readString(payload.text) } };
    }
    case Command.FileGet: return { type: request.type, payload: target };
    case Command.FileSetEnabled: return { type: request.type, payload: { ...target, enabled: readBoolean(payload.enabled) } };
    default: throw new Error("Unknown tab command.");
  }
}

type OutputParsers = { [K in CommandName]: (value: unknown) => Calls[K]["output"] };

const outputParsers: OutputParsers = {
  [Command.DebugSeek]: parseSeekObservation,
  [Command.DebugGet]: parseDebugState,
  [Command.DebugConfigure]: parseDebugState,
  [Command.SessionGet]: parsePlayback,
  [Command.FileLoad]: parseLoadedSkipState,
  [Command.FileGet]: parseSkipState,
  [Command.FileSetEnabled]: parseLoadedSkipState
};

export function parseReply<K extends CommandName>(type: K, value: unknown): Reply<Calls[K]["output"]> {
  const reply = readObject(value);
  if (reply.ok === true) return { ok: true, data: outputParsers[type](reply.data) };
  if (reply.ok !== false) throw new Error("Invalid tab reply.");
  const error = readObject(reply.error);
  if (error.code !== "NOT_IMPLEMENTED" && error.code !== "SEEK_FAILED" && error.code !== "REQUEST_FAILED") {
    throw new Error("Invalid tab error code.");
  }
  return { ok: false, error: { code: error.code, message: readString(error.message) } };
}
