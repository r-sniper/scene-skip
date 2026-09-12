import type { Calls, ContentCommand, Target } from "../shared/messages.ts";
import type { LoadedSkipState, Reply, SessionState } from "../shared/contracts.ts";
import { notImplemented } from "../shared/not-implemented.ts";
import { Command } from "../shared/commands.ts";
import { requireCapability, resolvePlatform } from "../platforms/registry.ts";

export async function ensureSession(_target: Target): Promise<void> {
  notImplemented("ensureSession");
}

export async function sendToSession(_target: Target, _command: ContentCommand): Promise<SessionState> {
  notImplemented("sendToSession");
}

export async function getSession(_input: Calls[Command.SessionGet]["input"]): Promise<SessionState> {
  notImplemented(Command.SessionGet);
}

export async function loadFile(input: Calls[Command.FileLoad]["input"]): Promise<Reply<LoadedSkipState>> {
  const tab = await chrome.tabs.get(input.tabId);
  if (!tab.url) throw new Error("Open the extension from the video tab to grant access.");
  const platform = resolvePlatform(input.platform, tab.url);
  requireCapability(platform, "skipFiles");
  return platform.loadFile({ tabId: input.tabId, url: tab.url }, input.filename, input.text);
}

export async function getFile(input: Calls[Command.FileGet]["input"]) {
  const tab = await chrome.tabs.get(input.tabId);
  if (!tab.url) throw new Error("Open the extension from the video tab to grant access.");
  const platform = resolvePlatform(input.platform, tab.url);
  requireCapability(platform, "skipFiles");
  return platform.getFile({ tabId: input.tabId, url: tab.url });
}

export async function setFileEnabled(input: Calls[Command.FileSetEnabled]["input"]) {
  const tab = await chrome.tabs.get(input.tabId);
  if (!tab.url) throw new Error("Open the extension from the video tab to grant access.");
  const platform = resolvePlatform(input.platform, tab.url);
  requireCapability(platform, "skipFiles");
  return platform.setFileEnabled({ tabId: input.tabId, url: tab.url }, input.enabled);
}

export async function clearFile(_input: Calls[Command.FileClear]["input"]): Promise<SessionState> {
  notImplemented(Command.FileClear);
}

export async function configurePlayback(_input: Calls[Command.PlaybackConfigure]["input"]): Promise<SessionState> {
  notImplemented(Command.PlaybackConfigure);
}
