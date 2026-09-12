import type { Platform, PlatformPreferences } from "../shared/contracts.ts";
import { notImplemented } from "../shared/not-implemented.ts";
import { Command } from "../shared/commands.ts";

export async function getPreferences(_platform: Platform): Promise<PlatformPreferences> {
  notImplemented(Command.PreferencesGet);
}

export async function setPreferences(_platform: Platform, _preferences: PlatformPreferences): Promise<void> {
  notImplemented(Command.PreferencesSet);
}
