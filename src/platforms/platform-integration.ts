import type { DebugOptions, DebugState, LoadedSkipState, PlatformInfo, Reply, SeekObservation, SkipState } from "../shared/contracts.ts";

export interface VideoTarget {
  tabId: number;
  url: string;
}

export interface PlatformIntegration extends PlatformInfo {
  assertVideoUrl(url: URL): void;
  debugSeek(target: VideoTarget, seconds: number): Promise<Reply<SeekObservation>>;
  getDebug(target: VideoTarget): Promise<Reply<DebugState>>;
  configureDebug(target: VideoTarget, options: DebugOptions): Promise<Reply<DebugState>>;
  loadFile(target: VideoTarget, filename: string, text: string): Promise<Reply<LoadedSkipState>>;
  getFile(target: VideoTarget): Promise<Reply<SkipState>>;
  setFileEnabled(target: VideoTarget, enabled: boolean): Promise<Reply<LoadedSkipState>>;
}
