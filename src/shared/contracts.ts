export type Platform = "netflix" | "prime" | "youtube";

export interface PlatformCapabilities {
  readonly debugSeek: boolean;
  readonly skipFiles: boolean;
  readonly playerOverlays: boolean;
}

export interface PlatformInfo {
  readonly id: Platform;
  readonly label: string;
  readonly capabilities: PlatformCapabilities;
}

export interface SkipRange {
  startSeconds: number;
  endSeconds: number;
  reason: string;
}

export interface SkipFile {
  filename: string;
  ranges: SkipRange[];
}

export interface LoadedSkipState {
  file: SkipFile;
  enabled: boolean;
  error: string | null;
}

export type SkipState = { file: null; enabled: false; error: null } | LoadedSkipState;

export interface PlaybackSnapshot {
  currentSeconds: number;
  durationSeconds: number;
  paused: boolean;
  ended: boolean;
}

export interface SeekObservation {
  requestedSeconds: number;
  observedSeconds: number;
}

export interface DebugOptions {
  showTimestamp: boolean;
  showSkipRanges: boolean;
}

export interface DebugState {
  options: DebugOptions;
  error: string | null;
}

export interface DebugDisplay {
  render(playback: PlaybackSnapshot, options: DebugOptions, ranges: readonly SkipRange[]): void;
  clear(): void;
  showError(message: string): void;
}

export type Reply<T> =
  | { ok: true; data: T }
  | { ok: false; error: { code: "NOT_IMPLEMENTED" | "SEEK_FAILED" | "REQUEST_FAILED"; message: string } };

export interface Player {
  readPlayback(): Promise<PlaybackSnapshot>;
  seekTo(seconds: number): Promise<SeekObservation>;
}

export type SkipPlayer = Player;
export type PlaybackReader = Pick<Player, "readPlayback">;
