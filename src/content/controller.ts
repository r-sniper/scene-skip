import type { LoadedSkipState, PlaybackOptions, SeekObservation, SessionState, SkipFile, SkipPlayer } from "../shared/contracts.ts";
import { parseSrt } from "../skipfiles/srt.ts";
import { SkipEngine } from "./skip-engine.ts";
import { notImplemented } from "../shared/not-implemented.ts";

export class SessionController {
  private readonly skipEngine: SkipEngine;
  private error: string | null = null;
  readonly file: SkipFile;

  private constructor(player: SkipPlayer, file: SkipFile) {
    this.file = file;
    this.skipEngine = new SkipEngine(player, file.ranges);
  }

  static loadFile(player: SkipPlayer, filename: string, text: string): SessionController {
    return new SessionController(player, { filename, ranges: parseSrt(text) });
  }

  validate(): Promise<void> {
    return this.skipEngine.validate();
  }

  readSkipState(): LoadedSkipState {
    return { file: this.file, enabled: this.skipEngine.enabled, error: this.error };
  }

  setEnabled(enabled: boolean): LoadedSkipState {
    if (enabled && this.error !== null) throw new Error(`Skipping stopped: ${this.error} Reload the video page to start again.`);
    this.skipEngine.enabled = enabled;
    return this.readSkipState();
  }

  async start(): Promise<void> {
    while (true) {
      await this.tick();
      await new Promise<void>(resolve => setTimeout(resolve, 250));
    }
  }
  readState(): SessionState { notImplemented("SessionController.readState"); }
  clearFile(): SessionState { notImplemented("SessionController.clearFile"); }
  configure(_options: PlaybackOptions): SessionState { notImplemented("SessionController.configure"); }
  async tick(): Promise<SeekObservation | null> {
    try {
      return await this.skipEngine.tick();
    } catch (error) {
      this.error = error instanceof Error ? error.message : String(error);
      throw error;
    }
  }
  onContentChange(): void { notImplemented("SessionController.onContentChange"); }
  onPlayerReplaced(): void { notImplemented("SessionController.onPlayerReplaced"); }
  stop(): void { notImplemented("SessionController.stop"); }
}
