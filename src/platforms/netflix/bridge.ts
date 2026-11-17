import type { PlaybackSnapshot, Reply, SeekObservation } from "../../shared/contracts.ts";
import { getNetflixContentId } from "./identity.ts";
import { NetflixPlayerAdapter } from "./player.ts";
import { isRecord, NETFLIX_PLAYER_CHANNEL, readPlayerCommand } from "./protocol.ts";
import type { NetflixPlayerResponse } from "./protocol.ts";

declare global {
  interface Window {
    __sceneSkipNetflixBridgeInstalled?: boolean;
  }
}

async function execute(command: unknown): Promise<Reply<PlaybackSnapshot | SeekObservation>> {
  try {
    const request = readPlayerCommand(command);
    if (getNetflixContentId(location.href) !== request.contentId) throw new Error("The Netflix video changed. Open the extension for the current title.");
    const player = new NetflixPlayerAdapter(location.href);
    return { ok: true, data: request.operation === "read" ? await player.readPlayback() : await player.seekTo(request.seconds) };
  } catch (error) {
    return { ok: false, error: { code: "REQUEST_FAILED", message: error instanceof Error ? error.message : String(error) } };
  }
}

export function installNetflixBridge(): void {
  if (window.__sceneSkipNetflixBridgeInstalled) return;
  window.addEventListener("message", (event: MessageEvent<unknown>) => {
    if (event.source !== window || event.origin !== location.origin) return;
    const message = event.data;
    if (!isRecord(message) || message.channel !== NETFLIX_PLAYER_CHANNEL || message.direction !== "request") return;
    if (typeof message.requestId !== "string" || message.requestId.length === 0) throw new Error("Netflix player request requires an ID.");
    const requestId = message.requestId;
    void execute(message.command).then(reply => {
      const response: NetflixPlayerResponse = { channel: NETFLIX_PLAYER_CHANNEL, direction: "response", requestId, reply };
      window.postMessage(response, location.origin);
    });
  });
  window.__sceneSkipNetflixBridgeInstalled = true;
}
