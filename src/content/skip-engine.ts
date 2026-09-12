import type { SeekObservation, SkipPlayer, SkipRange } from "../shared/contracts.ts";
import { prepareSkipIntervals } from "./skip-ranges.ts";
import type { SkipInterval } from "./skip-ranges.ts";

export class SkipEngine {
  private readonly player: SkipPlayer;
  private readonly intervals: SkipInterval[];
  enabled = true;

  constructor(player: SkipPlayer, ranges: readonly SkipRange[], offsetSeconds = 0) {
    this.player = player;
    this.intervals = prepareSkipIntervals(ranges, offsetSeconds);
  }

  private validateDuration(durationSeconds: number): void {
    const lastInterval = this.intervals[this.intervals.length - 1];
    if (lastInterval.endSeconds > durationSeconds) {
      throw new Error(`Skip range ends at ${lastInterval.endSeconds}s, beyond the video's ${durationSeconds}s duration.`);
    }
  }

  async validate(): Promise<void> {
    const playback = await this.player.readPlayback();
    this.validateDuration(playback.durationSeconds);
  }

  async tick(): Promise<SeekObservation | null> {
    if (!this.enabled) return null;
    const playback = await this.player.readPlayback();
    this.validateDuration(playback.durationSeconds);
    if (!this.enabled) return null;
    if (playback.paused || playback.ended) return null;

    const interval = this.intervals.find(range => range.startSeconds <= playback.currentSeconds && playback.currentSeconds < range.endSeconds);
    if (!interval) return null;

    return this.player.seekTo(interval.endSeconds);
  }
}
