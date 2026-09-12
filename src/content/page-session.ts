import { SessionController } from "./controller.ts";
import type { LoadedSkipState, Reply, SeekObservation, SkipFile, SkipPlayer, SkipState } from "../shared/contracts.ts";

type PlayerFactory = (expectedUrl: string) => SkipPlayer;

export class PageSession {
  private readonly createPlayer: PlayerFactory;
  private controller: SessionController | null = null;

  constructor(createPlayer: PlayerFactory) {
    this.createPlayer = createPlayer;
  }

  get loadedFile(): SkipFile | null {
    return this.controller ? this.controller.file : null;
  }

  getFile(): SkipState {
    return this.controller ? this.controller.readSkipState() : { file: null, enabled: false, error: null };
  }

  async setFileEnabled(enabled: boolean): Promise<Reply<LoadedSkipState>> {
    try {
      if (typeof enabled !== "boolean") throw new Error("Skipping must be enabled or disabled with a boolean.");
      if (!this.controller) throw new Error("Load an SRT before enabling skipping.");
      return { ok: true, data: this.controller.setEnabled(enabled) };
    } catch (error) {
      return { ok: false, error: { code: "REQUEST_FAILED", message: error instanceof Error ? error.message : String(error) } };
    }
  }

  async debugSeek(seconds: number, expectedUrl: string): Promise<Reply<SeekObservation>> {
    try {
      const player = this.createPlayer(expectedUrl);
      return { ok: true, data: await player.seekTo(seconds) };
    } catch (error) {
      return { ok: false, error: { code: "SEEK_FAILED", message: error instanceof Error ? error.message : String(error) } };
    }
  }

  async loadFile(filename: string, text: string, expectedUrl: string): Promise<Reply<LoadedSkipState>> {
    try {
      if (this.controller) throw new Error("A file has already been loaded. Reload the video page to load another file.");
      const player = this.createPlayer(expectedUrl);
      const controller = SessionController.loadFile(player, filename, text);
      await controller.validate();
      this.controller = controller;
      void controller.start().catch(error => {
        console.error("Scene Skip automatic skipping stopped:", error);
      });
      return { ok: true, data: controller.readSkipState() };
    } catch (error) {
      return { ok: false, error: { code: "REQUEST_FAILED", message: error instanceof Error ? error.message : String(error) } };
    }
  }
}
