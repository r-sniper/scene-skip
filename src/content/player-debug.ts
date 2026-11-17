import type { DebugDisplay, DebugOptions, DebugState, PlaybackReader, Reply, SkipFile, SkipRange } from "../shared/contracts.ts";

export class PlayerDebugController {
  private options: DebugOptions = { showTimestamp: false, showSkipRanges: false };
  private error: string | null = null;
  private timer: ReturnType<typeof setTimeout> | null = null;

  constructor(
    private readonly player: PlaybackReader,
    private readonly getFile: () => SkipFile | null,
    private readonly display: DebugDisplay
  ) {}

  readState(): DebugState {
    return { options: this.options, error: this.error };
  }

  stop(): void {
    if (this.timer !== null) clearTimeout(this.timer);
    this.timer = null;
    this.options = { showTimestamp: false, showSkipRanges: false };
    this.error = null;
    this.display.clear();
  }

  async configure(options: DebugOptions): Promise<Reply<DebugState>> {
    try {
      if (!options || typeof options.showTimestamp !== "boolean" || typeof options.showSkipRanges !== "boolean") {
        throw new Error("Player overlay settings must be booleans.");
      }
      if (options.showSkipRanges && !this.getFile()) throw new Error("Load a skip file before showing skip segments.");

      if (options.showTimestamp || options.showSkipRanges) {
        const playback = await this.player.readPlayback();
        this.display.render(playback, options, this.ranges());
      } else {
        this.display.clear();
      }

      if (this.timer !== null) clearTimeout(this.timer);
      this.options = options;
      this.error = null;
      if (options.showTimestamp || options.showSkipRanges) this.schedule(options);
      return { ok: true, data: this.readState() };
    } catch (error) {
      return { ok: false, error: { code: "REQUEST_FAILED", message: error instanceof Error ? error.message : String(error) } };
    }
  }

  private ranges(): readonly SkipRange[] {
    const file = this.getFile();
    return file ? file.ranges : [];
  }

  private schedule(options: DebugOptions): void {
    this.timer = setTimeout(() => { void this.refresh(options); }, 100);
  }

  private async refresh(options: DebugOptions): Promise<void> {
    try {
      const playback = await this.player.readPlayback();
      if (this.options !== options) return;
      this.display.render(playback, options, this.ranges());
      this.schedule(options);
    } catch (error) {
      if (this.options !== options) return;
      this.error = error instanceof Error ? error.message : String(error);
      this.display.showError(this.error);
    }
  }
}
