import { parseReply } from "../shared/messages.ts";
import type { Calls, CommandName } from "../shared/messages.ts";
import type { PlatformCapabilities } from "../shared/contracts.ts";
import { Command } from "../shared/commands.ts";
import { getPlatformInfo, identifyPlatformInfo } from "../platforms/catalog.ts";

const documents = new Map<number, Promise<string>>();

function capabilityFor(type: CommandName): keyof PlatformCapabilities {
  switch (type) {
    case Command.DebugSeek: case Command.SessionGet: return "debugSeek";
    case Command.DebugGet: case Command.DebugConfigure: return "playerOverlays";
    case Command.FileLoad: case Command.FileGet: case Command.FileSetEnabled: return "skipFiles";
  }
}

async function install(tabId: number): Promise<string> {
  const [main] = await chrome.scripting.executeScript({
    target: { tabId, frameIds: [0] },
    world: "MAIN",
    files: ["platforms/netflix/page.js"]
  });
  if (!main || main.frameId !== 0 || typeof main.documentId !== "string") {
    throw new Error("The Netflix document did not finish initializing.");
  }
  await chrome.scripting.executeScript({
    target: { tabId, documentIds: [main.documentId] },
    world: "ISOLATED",
    files: ["content/index.js"]
  });
  return main.documentId;
}

export async function call<K extends CommandName>(type: K, payload: Calls[K]["input"]): Promise<Calls[K]["output"]> {
  const tab = await chrome.tabs.get(payload.tabId);
  if (!tab.url) throw new Error("Open the extension from the video tab to grant access.");
  const platform = getPlatformInfo(payload.platform);
  if (identifyPlatformInfo(tab.url)?.id !== platform.id) {
    throw new Error(`Open a ${platform.label} video in this tab, or select its platform.`);
  }
  if (!platform.capabilities[capabilityFor(type)]) throw new Error(`${platform.label}: this feature is not implemented.`);
  if (!/^\/watch\/\d+(?:\/|$)/.test(new URL(tab.url).pathname)) throw new Error("Open the Netflix movie or episode player first.");

  let document = documents.get(payload.tabId);
  if (document === undefined) {
    document = install(payload.tabId);
    documents.set(payload.tabId, document);
  }
  const documentId = await document;
  const response: unknown = await chrome.tabs.sendMessage(payload.tabId, { type, payload }, { documentId });
  const reply = parseReply(type, response);
  if (!reply.ok) throw new Error(reply.error.message);
  return reply.data;
}
