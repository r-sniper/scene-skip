import type { DebugDisplay, DebugOptions, PlaybackSnapshot, SkipRange } from "../../shared/contracts.ts";
import { formatTimestamp } from "../../shared/time.ts";
import { prepareSkipIntervals } from "../../content/skip-ranges.ts";

const styles = `
  :host { all: initial; position: fixed; z-index: 2147483647; pointer-events: none; }
  :host([data-scene-skip="track"]) { position: absolute; left: 0; right: 0; bottom: 100%; padding-bottom: 3px; }
  .clock {
    display: block; padding: .45rem .65rem; border-radius: .5rem;
    background: rgba(18, 20, 24, .88); color: #fff;
    font: 500 14px/1.4 system-ui, sans-serif; font-variant-numeric: tabular-nums;
    letter-spacing: .02em; box-shadow: 0 2px 10px #0004;
    backdrop-filter: blur(12px); max-width: 32rem;
  }
  .error { color: #ffd0c9; }
  .track { position: relative; height: 6px; border-radius: 3px; background: #111a; }
  .segment {
    position: absolute; top: 0; height: 100%; min-width: 2px;
    border-radius: 2px; background: #c5f685; box-shadow: 0 0 0 1px #17220c;
  }
  @media (prefers-reduced-transparency: reduce) { .clock { background: #121418; backdrop-filter: none; } }
  @media (prefers-contrast: more) {
    .clock { background: #000; border: 1px solid #fff; backdrop-filter: none; }
    .segment { background: #dcffa6; }
  }
`;

function createLayer(className: string): { host: HTMLDivElement; content: HTMLDivElement } {
  const host = document.createElement("div");
  host.dataset.sceneSkip = className;
  const shadow = host.attachShadow({ mode: "open" });
  const style = document.createElement("style");
  style.textContent = styles;
  const content = document.createElement("div");
  content.className = className;
  shadow.append(style, content);
  return { host, content };
}

export class NetflixDebugOverlay implements DebugDisplay {
  private readonly clock = createLayer("clock");
  private readonly timeline = createLayer("track");
  private renderedRanges: readonly SkipRange[] | null = null;
  private renderedDuration: number | null = null;
  private timelineBar: HTMLElement | null = null;
  private originalPosition: string | null = null;

  render(playback: PlaybackSnapshot, options: DebugOptions, ranges: readonly SkipRange[]): void {
    const player = document.querySelector<HTMLElement>(".watch-video");
    const video = player?.querySelector<HTMLVideoElement>("video");
    if (!player || !video) throw new Error("Netflix player overlay unavailable. Open a movie or episode first.");
    if (options.showSkipRanges) this.renderRanges(ranges, playback.durationSeconds);

    if (options.showTimestamp) {
      const bounds = video.getBoundingClientRect();
      if (this.clock.host.parentElement !== player) player.append(this.clock.host);
      this.clock.host.style.left = `${bounds.left + 16}px`;
      this.clock.host.style.top = `${bounds.top + 16}px`;
      this.clock.content.className = "clock";
      this.clock.content.textContent = formatTimestamp(playback.currentSeconds);
      this.clock.content.setAttribute("aria-label", `Player time ${formatTimestamp(playback.currentSeconds)}`);
      this.clock.content.setAttribute("role", "timer");
    } else {
      this.clock.host.remove();
    }

    if (!options.showSkipRanges) {
      this.removeTimeline();
      return;
    }

    // Netflix may unmount its seek bar while playback controls are hidden.
    const scrubber = player.querySelector<HTMLElement>('[data-uia="timeline-bar"]');
    if (!scrubber) {
      this.removeTimeline();
      return;
    }
    if (this.timelineBar !== scrubber) {
      this.removeTimeline();
      this.timelineBar = scrubber;
      if (getComputedStyle(scrubber).position === "static") {
        this.originalPosition = scrubber.style.position;
        scrubber.style.position = "relative";
      }
    }
    if (this.timeline.host.parentElement !== scrubber) scrubber.append(this.timeline.host);
  }

  private renderRanges(ranges: readonly SkipRange[], durationSeconds: number): void {
    if (this.renderedRanges === ranges && this.renderedDuration === durationSeconds) return;
    const intervals = prepareSkipIntervals(ranges, 0);
    if (intervals.some(range => range.endSeconds > durationSeconds)) {
      throw new Error("Skip segments extend beyond the video's duration.");
    }
    this.timeline.content.replaceChildren(...intervals.map(range => {
      const marker = document.createElement("span");
      marker.className = "segment";
      marker.style.left = `${range.startSeconds / durationSeconds * 100}%`;
      marker.style.width = `${(range.endSeconds - range.startSeconds) / durationSeconds * 100}%`;
      return marker;
    }));
    this.timeline.content.setAttribute("role", "img");
    this.timeline.content.setAttribute("aria-label", `Skip segments: ${ranges.map(range => `${formatTimestamp(range.startSeconds)} to ${formatTimestamp(range.endSeconds)}: ${range.reason}`).join("; ")}`);
    this.renderedRanges = ranges;
    this.renderedDuration = durationSeconds;
  }

  private removeTimeline(): void {
    this.timeline.host.remove();
    if (this.timelineBar) {
      if (this.originalPosition !== null) this.timelineBar.style.position = this.originalPosition;
      this.timelineBar = null;
      this.originalPosition = null;
    }
  }

  clear(): void {
    this.clock.host.remove();
    this.removeTimeline();
  }

  showError(message: string): void {
    this.removeTimeline();
    const player = document.querySelector<HTMLElement>(".watch-video");
    if (player) {
      player.append(this.clock.host);
      this.clock.host.style.left = "16px";
      this.clock.host.style.top = "16px";
      this.clock.content.className = "clock error";
      this.clock.content.setAttribute("role", "alert");
      this.clock.content.removeAttribute("aria-label");
      this.clock.content.textContent = `Scene Skip debug stopped: ${message}`;
    }
    console.error("Scene Skip player overlays stopped:", message);
  }
}
