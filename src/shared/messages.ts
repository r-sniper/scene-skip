import type { DebugOptions, DebugState, LoadedSkipState, Platform, PlatformPreferences, PlaybackOptions, SeekObservation, SessionState, SkipState } from "./contracts.ts";
import { Command } from "./commands.ts";

export interface Target {
  tabId: number;
  platform: Platform;
}

export interface Calls {
  [Command.DebugSeek]: { input: Target & { timestamp: string }; output: SeekObservation };
  [Command.DebugGet]: { input: Target; output: DebugState };
  [Command.DebugConfigure]: { input: Target & { options: DebugOptions }; output: DebugState };
  [Command.SessionGet]: { input: Target; output: SessionState };
  [Command.FileLoad]: { input: Target & { filename: string; text: string }; output: LoadedSkipState };
  [Command.FileGet]: { input: Target; output: SkipState };
  [Command.FileSetEnabled]: { input: Target & { enabled: boolean }; output: LoadedSkipState };
  [Command.FileClear]: { input: Target; output: SessionState };
  [Command.PlaybackConfigure]: { input: Target & { options: PlaybackOptions }; output: SessionState };
  [Command.PreferencesGet]: { input: { platform: Platform }; output: PlatformPreferences };
  [Command.PreferencesSet]: { input: { platform: Platform; preferences: PlatformPreferences }; output: null };
}

export type CommandName = keyof Calls;
export type Request = {
  [K in CommandName]: { type: K; payload: Calls[K]["input"] }
}[CommandName];

export type ContentCommand =
  | { type: Command.SessionStart; platform: Platform }
  | { type: Command.SessionGet }
  | { type: Command.FileLoad; filename: string; text: string }
  | { type: Command.FileClear }
  | { type: Command.PlaybackConfigure; options: PlaybackOptions }
  | { type: Command.SessionStop };
