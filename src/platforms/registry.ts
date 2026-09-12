import type { Platform, PlatformCapabilities } from "../shared/contracts.ts";
import type { PlatformIntegration } from "./platform-integration.ts";
import { NetflixIntegration } from "./netflix/integration.ts";
import { PrimeIntegration } from "./prime/integration.ts";
import { YouTubeIntegration } from "./youtube/integration.ts";
import { identifyPlatformInfo } from "./catalog.ts";
import { notImplemented } from "../shared/not-implemented.ts";

const integrations: Record<Platform, PlatformIntegration> = {
  netflix: new NetflixIntegration(),
  prime: new PrimeIntegration(),
  youtube: new YouTubeIntegration()
};

export function getPlatform(id: Platform): PlatformIntegration {
  return integrations[id];
}

export function identifyPlatform(address: string): PlatformIntegration | undefined {
  const info = identifyPlatformInfo(address);
  return info ? getPlatform(info.id) : undefined;
}

export function requireCapability(platform: PlatformIntegration, capability: keyof PlatformCapabilities): void {
  if (!platform.capabilities[capability]) notImplemented(`${platform.label}: ${capability}`);
}

export function resolvePlatform(selected: Platform, address: string): PlatformIntegration {
  const url = new URL(address);
  const platform = getPlatform(selected);
  if (identifyPlatform(address)?.id !== selected) {
    throw new Error(`Open a ${platform.label} video in this tab, or select its platform.`);
  }
  platform.assertVideoUrl(url);
  return platform;
}
