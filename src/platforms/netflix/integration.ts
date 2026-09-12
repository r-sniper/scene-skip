import type { PlatformIntegration, VideoTarget } from "../platform-integration.ts";
import { injectNetflix } from "./inject.ts";
import type { DebugOptions } from "../../shared/contracts.ts";
import { getPlatformInfo } from "../catalog.ts";

export class NetflixIntegration implements PlatformIntegration {
  readonly id = "netflix";
  readonly label = getPlatformInfo(this.id).label;
  readonly capabilities = getPlatformInfo(this.id).capabilities;

  assertVideoUrl(url: URL): void {
    if (!/^\/watch\/\d+(?:\/|$)/.test(url.pathname)) {
      throw new Error("Open the Netflix movie or episode player first.");
    }
  }

  debugSeek(target: VideoTarget, seconds: number) {
    return injectNetflix(target.tabId, (seconds: number, url: string) => window.__sceneSkipNetflix!.debugSeek(seconds, url), [seconds, target.url]);
  }

  loadFile(target: VideoTarget, filename: string, text: string) {
    return injectNetflix(target.tabId, (filename, text, url) => window.__sceneSkipNetflix!.loadFile(filename, text, url), [filename, text, target.url]);
  }

  getFile(target: VideoTarget) {
    return injectNetflix(target.tabId, async () => ({ ok: true, data: window.__sceneSkipNetflix!.getFile() }), []);
  }

  setFileEnabled(target: VideoTarget, enabled: boolean) {
    return injectNetflix(target.tabId, (enabled: boolean) => window.__sceneSkipNetflix!.setFileEnabled(enabled), [enabled]);
  }

  getDebug(target: VideoTarget) {
    return injectNetflix(target.tabId, async () => ({ ok: true, data: window.__sceneSkipNetflixDebug!.readState() }), []);
  }

  configureDebug(target: VideoTarget, options: DebugOptions) {
    return injectNetflix(target.tabId, (options: DebugOptions, url: string) => window.__sceneSkipNetflixDebug!.configure(options, url), [options, target.url]);
  }
}
