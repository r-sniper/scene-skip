import type { PlatformIntegration, VideoTarget } from "../platform-integration.ts";
import { injectSeek } from "../inject-seek.ts";
import { seekHtmlVideo } from "../html-video.ts";
import { notImplemented } from "../../shared/not-implemented.ts";
import type { DebugOptions, DebugState, LoadedSkipState, Reply, SkipState } from "../../shared/contracts.ts";
import { getPlatformInfo } from "../catalog.ts";

export class YouTubeIntegration implements PlatformIntegration {
  readonly id = "youtube";
  readonly label = getPlatformInfo(this.id).label;
  readonly capabilities = getPlatformInfo(this.id).capabilities;

  assertVideoUrl(url: URL): void {
    if (url.pathname !== "/watch" || !url.searchParams.get("v")) {
      throw new Error("Use a YouTube watch page; Shorts and embeds are outside this skeleton.");
    }
  }

  loadFile(_target: VideoTarget, _filename: string, _text: string): Promise<Reply<LoadedSkipState>> {
    notImplemented("YouTubeIntegration.loadFile");
  }

  getFile(_target: VideoTarget): Promise<Reply<SkipState>> {
    notImplemented("YouTubeIntegration.getFile");
  }

  setFileEnabled(_target: VideoTarget, _enabled: boolean): Promise<Reply<LoadedSkipState>> {
    notImplemented("YouTubeIntegration.setFileEnabled");
  }

  getDebug(_target: VideoTarget): Promise<Reply<DebugState>> {
    notImplemented("YouTube player overlays");
  }

  configureDebug(_target: VideoTarget, _options: DebugOptions): Promise<Reply<DebugState>> {
    notImplemented("YouTube player overlays");
  }

  debugSeek(target: VideoTarget, seconds: number) {
    return injectSeek(target.tabId, "ISOLATED", seekHtmlVideo, [seconds, {
      video: "#movie_player video.html5-main-video",
      advertisement: "#movie_player.ad-showing, #movie_player.ad-interrupting"
    }, target.url]);
  }
}
