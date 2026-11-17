import type { LoadedSkipState, PlaybackSnapshot, Player, SeekObservation, SkipFile, SkipState } from "../shared/contracts.ts";
import { parseSrt } from "../skipfiles/srt.ts";
import { SkipEngine } from "./skip-engine.ts";

interface LoadedSession {
  readonly file: SkipFile;
  readonly engine: SkipEngine;
  readonly contentId: string;
  error: string | null;
}

export class SessionController {
  private session: LoadedSession | null = null;
  private loading = false;
  private manualSeekVersion = 0;
  private pendingManualSeeks = 0;

  constructor(
    private readonly player: Player,
    private readonly readContentId: () => string | null
  ) {}

  get loadedFile(): SkipFile | null {
    return this.reconcileContent()?.file ?? null;
  }

  getFile(): SkipState {
    const session = this.reconcileContent();
    return session ? this.loadedState(session) : { file: null, enabled: false, error: null };
  }

  setFileEnabled(enabled: boolean): LoadedSkipState {
    const session = this.reconcileContent();
    if (!session) throw new Error("Load an SRT before enabling skipping.");
    if (enabled && session.error !== null) throw new Error(`Skipping stopped: ${session.error} Reload the video page to start again.`);
    session.engine.enabled = enabled;
    return this.loadedState(session);
  }

  async loadFile(filename: string, text: string): Promise<LoadedSkipState> {
    if (this.loading) throw new Error("A skip file is already being loaded.");
    if (this.reconcileContent()) throw new Error("A file has already been loaded. Reload the video page to load another file.");
    const contentId = this.requireContentId();
    this.loading = true;
    try {
      const file: SkipFile = { filename, ranges: parseSrt(text) };
      const engine = new SkipEngine(this.player, file.ranges);
      const playback = await this.readPlayback();
      this.assertContent(contentId);
      engine.validateDuration(playback.durationSeconds);
      const session: LoadedSession = { file, engine, contentId, error: null };
      this.session = session;
      void this.run(session);
      return this.loadedState(session);
    } finally {
      this.loading = false;
    }
  }

  async debugSeek(seconds: number): Promise<SeekObservation> {
    this.reconcileContent();
    const contentId = this.requireContentId();
    this.manualSeekVersion += 1;
    this.pendingManualSeeks += 1;
    try {
      const result = await this.player.seekTo(seconds);
      this.assertContent(contentId);
      return result;
    } finally {
      this.pendingManualSeeks -= 1;
      this.reconcileContent();
    }
  }

  async readPlayback(): Promise<PlaybackSnapshot> {
    this.reconcileContent();
    const contentId = this.requireContentId();
    try {
      const playback = await this.player.readPlayback();
      this.assertContent(contentId);
      return playback;
    } finally {
      this.reconcileContent();
    }
  }

  private loadedState(session: LoadedSession): LoadedSkipState {
    return { file: session.file, enabled: session.engine.enabled, error: session.error };
  }

  private requireContentId(): string {
    const contentId = this.readContentId();
    if (contentId === null) throw new Error("Open a supported movie or episode first.");
    return contentId;
  }

  private assertContent(expectedContentId: string): void {
    if (this.readContentId() !== expectedContentId) throw new Error("The video changed before the player replied. Load the matching skip file.");
  }

  private reconcileContent(): LoadedSession | null {
    if (this.session && this.readContentId() !== this.session.contentId) {
      this.session.engine.enabled = false;
      this.session = null;
    }
    return this.session;
  }

  private async run(session: LoadedSession): Promise<void> {
    while (this.reconcileContent() === session) {
      try {
        if (this.pendingManualSeeks === 0) {
          const manualSeekVersion = this.manualSeekVersion;
          const playback = await this.readPlayback();
          if (this.reconcileContent() !== session) return;
          if (this.pendingManualSeeks === 0 && this.manualSeekVersion === manualSeekVersion) {
            await session.engine.tick(playback);
            if (this.reconcileContent() !== session) return;
          }
        }
      } catch (error) {
        if (this.reconcileContent() !== session) return;
        session.error = error instanceof Error ? error.message : String(error);
        return;
      }
      await new Promise<void>(resolve => setTimeout(resolve, 250));
    }
  }
}
