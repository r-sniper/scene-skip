import { PageSession } from "../../content/page-session.ts";
import { NetflixPlayerAdapter } from "./player.ts";
import { PlayerDebugController } from "../../content/player-debug.ts";
import { NetflixDebugOverlay } from "./debug-overlay.ts";

declare global {
  interface Window {
    __sceneSkipNetflix?: PageSession;
    __sceneSkipNetflixDebug?: PlayerDebugController;
  }
}

window.__sceneSkipNetflix ??= new PageSession(url => new NetflixPlayerAdapter(url));
window.__sceneSkipNetflixDebug ??= new PlayerDebugController(
  url => new NetflixPlayerAdapter(url),
  () => window.__sceneSkipNetflix!.loadedFile,
  new NetflixDebugOverlay()
);
