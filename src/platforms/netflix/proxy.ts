import type { PlaybackSnapshot, Player, SeekObservation } from "../../shared/contracts.ts";
import { parsePlayback, parseSeekObservation } from "../../shared/validation.ts";
import { getNetflixContentId } from "./identity.ts";
import { isRecord, NETFLIX_PLAYER_CHANNEL, readPlayerReply } from "./protocol.ts";
import type { NetflixPlayerCommand, NetflixPlayerRequest } from "./protocol.ts";

export class NetflixPlayerProxy implements Player {
  private contentId(): string {
    const id = getNetflixContentId(location.href);
    if (id === null) throw new Error("Open a Netflix movie or episode first.");
    return id;
  }

  readPlayback(): Promise<PlaybackSnapshot> {
    return this.request({ operation: "read", contentId: this.contentId() }, parsePlayback);
  }

  async seekTo(seconds: number): Promise<SeekObservation> {
    if (!Number.isFinite(seconds) || seconds < 0) throw new Error("Choose a non-negative, finite seek timestamp.");
    const observation = await this.request({ operation: "seek", contentId: this.contentId(), seconds }, parseSeekObservation);
    if (observation.requestedSeconds !== seconds) throw new Error("Netflix replied to a different seek target.");
    return observation;
  }

  private request<T>(command: NetflixPlayerCommand, readData: (value: unknown) => T): Promise<T> {
    const requestId = crypto.randomUUID();
    const request: NetflixPlayerRequest = { channel: NETFLIX_PLAYER_CHANNEL, direction: "request", requestId, command };
    return new Promise<T>((resolve, reject) => {
      const cleanup = () => {
        clearTimeout(timeout);
        window.removeEventListener("message", onMessage);
      };
      const onMessage = (event: MessageEvent<unknown>) => {
        if (event.source !== window || event.origin !== location.origin) return;
        const message = event.data;
        if (!isRecord(message) || message.channel !== NETFLIX_PLAYER_CHANNEL || message.direction !== "response" || message.requestId !== requestId) return;
        cleanup();
        try {
          if (getNetflixContentId(location.href) !== command.contentId) throw new Error("The Netflix video changed while the player request was pending.");
          resolve(readPlayerReply(message.reply, readData));
        } catch (error) {
          reject(error);
        }
      };
      const timeout = setTimeout(() => {
        cleanup();
        reject(new Error("Netflix player did not reply within 30 seconds."));
      }, 30_000);
      window.addEventListener("message", onMessage);
      try {
        window.postMessage(request, location.origin);
      } catch (error) {
        cleanup();
        reject(error);
      }
    });
  }
}
