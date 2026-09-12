import type { Reply } from "../shared/contracts.ts";
import type { Request } from "../shared/messages.ts";
import { Command } from "../shared/commands.ts";
import { configureDebug, debugSeek, getDebug } from "./debug.ts";
import { getSession, getFile, loadFile, setFileEnabled, clearFile, configurePlayback } from "./session-handlers.ts";
import { getPreferences, setPreferences } from "../storage/preferences.ts";

export async function route(request: Request): Promise<Reply<unknown>> {
  try {
    switch (request.type) {
      case Command.DebugSeek: return await debugSeek(request.payload);
      case Command.DebugGet: return await getDebug(request.payload);
      case Command.DebugConfigure: return await configureDebug(request.payload);
      case Command.SessionGet: return { ok: true, data: await getSession(request.payload) };
      case Command.FileLoad: return await loadFile(request.payload);
      case Command.FileGet: return await getFile(request.payload);
      case Command.FileSetEnabled: return await setFileEnabled(request.payload);
      case Command.FileClear: return { ok: true, data: await clearFile(request.payload) };
      case Command.PlaybackConfigure: return { ok: true, data: await configurePlayback(request.payload) };
      case Command.PreferencesGet: return { ok: true, data: await getPreferences(request.payload.platform) };
      case Command.PreferencesSet:
        await setPreferences(request.payload.platform, request.payload.preferences);
        return { ok: true, data: null };
    }
  } catch (error) {
    return { ok: false, error: {
      code: error instanceof Error && "code" in error && error.code === "NOT_IMPLEMENTED" ? "NOT_IMPLEMENTED" : "REQUEST_FAILED",
      message: error instanceof Error ? error.message : String(error)
    } };
  }
}
