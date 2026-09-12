import type { DebugDisplay, DebugOptions, DebugState, PlaybackReader, Reply, SkipFile, SkipRange } from "../shared/contracts.ts";

export class PlayerDebugController {
  private options: DebugOptions = { showTimestamp: false, showSkipRanges: false };
  private error: string | null = null;
  private timer: ReturnType<typeof setTimeout> | null = null;

  constructor(
    private readonly createPlayer: (expectedUrl: string) => PlaybackReader,
    private readonly getFile: () => SkipFile | null,
    private readonly display: DebugDisplay
  ) {}

  readState(): DebugState {
    return { options: this.options, error: this.error };
  }

  async configure(options: DebugOptions, expectedUrl: string): Promise<Reply<DebugState>> {
    try {
      if (!options || typeof options.showTimestamp !== "boolean" || typeof options.showSkipRanges !== "boolean") {
        throw new Error("Player overlay settings must be booleans.");
      }
      if (options.showSkipRanges && !this.getFile()) throw new Error("Load a skip file before showing skip segments.");

      const player = this.createPlayer(expectedUrl);
      if (options.showTimestamp || options.showSkipRanges) {
        const playback = await player.readPlayback();
        this.display.render(playback, options, this.ranges());
      } else {
        this.display.clear();
      }

      if (this.timer !== null) clearTimeout(this.timer);
      this.options = options;
      this.error = null;
      if (options.showTimestamp || options.showSkipRanges) this.schedule(player, options);
      return { ok: true, data: this.readState() };
    } catch (error) {
      return { ok: false, error: { code: "REQUEST_FAILED", message: error instanceof Error ? error.message : String(error) } };
    }
  }

  private ranges(): readonly SkipRange[] {
    const file = this.getFile();
    return file ? file.ranges : [];
  }

  private schedule(player: PlaybackReader, options: DebugOptions): void {
    this.timer = setTimeout(() => { void this.refresh(player, options); }, 100);
  }

  private async refresh(player: PlaybackReader, options: DebugOptions): Promise<void> {
    try {
      const playback = await player.readPlayback();
      if (this.options !== options) return;
      this.display.render(playback, options, this.ranges());
      this.schedule(player, options);
    } catch (error) {
      if (this.options !== options) return;
      this.error = error instanceof Error ? error.message : String(error);
      this.display.showError(this.error);
    }
  }
}
