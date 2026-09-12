import type { Platform, PlayerAdapter } from "../shared/contracts.ts";
import { NetflixPlayerAdapter } from "./netflix/player.ts";
import { PrimePlayerAdapter } from "./prime/player.ts";
import { YouTubePlayerAdapter } from "./youtube/player.ts";

const factories: Record<Platform, (url: string) => PlayerAdapter> = {
  netflix: url => new NetflixPlayerAdapter(url),
  prime: () => new PrimePlayerAdapter(),
  youtube: () => new YouTubePlayerAdapter()
};

export function createSessionAdapter(platform: Platform, url: string): PlayerAdapter {
  return factories[platform](url);
}
