import type { Platform, PlatformInfo } from "../shared/contracts.ts";

interface PlatformDefinition {
  info: PlatformInfo;
  hosts: readonly string[];
}

const definitions: Record<Platform, PlatformDefinition> = {
  netflix: {
    info: { id: "netflix", label: "Netflix", capabilities: { debugSeek: true, skipFiles: true, playerOverlays: true } },
    hosts: ["www.netflix.com", "netflix.com"]
  },
  prime: {
    info: { id: "prime", label: "Prime Video", capabilities: { debugSeek: false, skipFiles: false, playerOverlays: false } },
    hosts: ["www.primevideo.com", "primevideo.com", "www.amazon.in", "www.amazon.com"]
  },
  youtube: {
    info: { id: "youtube", label: "YouTube", capabilities: { debugSeek: false, skipFiles: false, playerOverlays: false } },
    hosts: ["www.youtube.com", "youtube.com"]
  }
};

export function getPlatformInfo(id: Platform): PlatformInfo {
  return definitions[id].info;
}

export function identifyPlatformInfo(address: string): PlatformInfo | undefined {
  const url = new URL(address);
  return Object.values(definitions).find(definition => url.protocol === "https:" && definition.hosts.includes(url.hostname))?.info;
}
