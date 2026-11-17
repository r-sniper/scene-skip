import { SessionController } from "./controller.ts";
import { PlayerDebugController } from "./player-debug.ts";
import { NetflixPlayerProxy } from "../platforms/netflix/proxy.ts";
import { getNetflixContentId } from "../platforms/netflix/identity.ts";
import { NetflixDebugOverlay } from "../platforms/netflix/debug-overlay.ts";
import { Command } from "../shared/commands.ts";
import { parseRequest } from "../shared/messages.ts";
import { parseTimestamp } from "../shared/time.ts";
import type { Reply } from "../shared/contracts.ts";

declare global {
  interface Window {
    __sceneSkipContentInstalled?: boolean;
  }
}

if (!window.__sceneSkipContentInstalled) {
  const player = new NetflixPlayerProxy();
  let contentId = getNetflixContentId(location.href);

  function readContentId(): string | null {
    const currentId = getNetflixContentId(location.href);
    if (currentId !== contentId) {
      debug.stop();
      contentId = currentId;
    }
    return currentId;
  }

  const controller = new SessionController(player, readContentId);
  const debug = new PlayerDebugController(controller, () => controller.loadedFile, new NetflixDebugOverlay());

  async function handleMessage(value: unknown): Promise<Reply<unknown>> {
    try {
      const request = parseRequest(value);
      if (request.payload.platform !== "netflix") throw new Error("Only Netflix playback is implemented.");
      readContentId();
      controller.getFile();
      switch (request.type) {
        case Command.DebugSeek: return { ok: true, data: await controller.debugSeek(parseTimestamp(request.payload.timestamp)) };
        case Command.SessionGet: return { ok: true, data: await controller.readPlayback() };
        case Command.FileLoad: return { ok: true, data: await controller.loadFile(request.payload.filename, request.payload.text) };
        case Command.FileGet: return { ok: true, data: controller.getFile() };
        case Command.FileSetEnabled: return { ok: true, data: controller.setFileEnabled(request.payload.enabled) };
        case Command.DebugGet: return { ok: true, data: debug.readState() };
        case Command.DebugConfigure: return await debug.configure(request.payload.options);
      }
    } catch (error) {
      return { ok: false, error: { code: "REQUEST_FAILED", message: error instanceof Error ? error.message : String(error) } };
    }
  }

  chrome.runtime.onMessage.addListener((request: unknown, sender, sendResponse) => {
    if (sender.id !== chrome.runtime.id || sender.url !== chrome.runtime.getURL("popup/index.html")) return;
    void handleMessage(request).then(sendResponse);
    return true;
  });
  window.__sceneSkipContentInstalled = true;
}
