import type { PlatformIntegration, VideoTarget } from "../platform-integration.ts";
import { injectSeek } from "../inject-seek.ts";
import { seekHtmlVideo } from "../html-video.ts";
import { notImplemented } from "../../shared/not-implemented.ts";
import type { DebugOptions, DebugState, LoadedSkipState, Reply, SkipState } from "../../shared/contracts.ts";
import { getPlatformInfo } from "../catalog.ts";

export class PrimeIntegration implements PlatformIntegration {
  readonly id = "prime";
  readonly label = getPlatformInfo(this.id).label;
  readonly capabilities = getPlatformInfo(this.id).capabilities;

  assertVideoUrl(_url: URL): void {
    // Prime player URLs vary. The injected probe checks for a visible, loaded player.
  }

  debugSeek(target: VideoTarget, seconds: number) {
    return injectSeek(target.tabId, "ISOLATED", seekHtmlVideo, [seconds, { video: "video" }, target.url]);
  }

  loadFile(_target: VideoTarget, _filename: string, _text: string): Promise<Reply<LoadedSkipState>> {
    notImplemented("PrimeIntegration.loadFile");
  }

  getFile(_target: VideoTarget): Promise<Reply<SkipState>> {
    notImplemented("PrimeIntegration.getFile");
  }

  setFileEnabled(_target: VideoTarget, _enabled: boolean): Promise<Reply<LoadedSkipState>> {
    notImplemented("PrimeIntegration.setFileEnabled");
  }

  getDebug(_target: VideoTarget): Promise<Reply<DebugState>> {
    notImplemented("Prime player overlays");
  }

  configureDebug(_target: VideoTarget, _options: DebugOptions): Promise<Reply<DebugState>> {
    notImplemented("Prime player overlays");
  }
}
