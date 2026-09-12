import { requireCapability, resolvePlatform } from "../platforms/registry.ts";
import { parseTimestamp } from "../shared/time.ts";
import { Command } from "../shared/commands.ts";
import type { Calls } from "../shared/messages.ts";
import type { Reply, SeekObservation } from "../shared/contracts.ts";

export async function debugSeek(input: Calls[Command.DebugSeek]["input"]): Promise<Reply<SeekObservation>> {
  const seconds = parseTimestamp(input.timestamp);
  const tab = await chrome.tabs.get(input.tabId);
  if (!tab.url) throw new Error("Open the extension from the video tab to grant access.");
  const platform = resolvePlatform(input.platform, tab.url);
  requireCapability(platform, "debugSeek");
  return platform.debugSeek({ tabId: input.tabId, url: tab.url }, seconds);
}

export async function getDebug(input: Calls[Command.DebugGet]["input"]) {
  const tab = await chrome.tabs.get(input.tabId);
  if (!tab.url) throw new Error("Open the extension from the video tab to grant access.");
  const platform = resolvePlatform(input.platform, tab.url);
  requireCapability(platform, "playerOverlays");
  return platform.getDebug({ tabId: input.tabId, url: tab.url });
}

export async function configureDebug(input: Calls[Command.DebugConfigure]["input"]) {
  const tab = await chrome.tabs.get(input.tabId);
  if (!tab.url) throw new Error("Open the extension from the video tab to grant access.");
  const platform = resolvePlatform(input.platform, tab.url);
  requireCapability(platform, "playerOverlays");
  return platform.configureDebug({ tabId: input.tabId, url: tab.url }, input.options);
}
