export function getNetflixContentId(address: string): string | null {
  const url = new URL(address);
  if (url.protocol !== "https:" || (url.hostname !== "www.netflix.com" && url.hostname !== "netflix.com")) return null;
  const match = /^\/watch\/(\d+)(?:\/|$)/.exec(url.pathname);
  return match ? match[1] : null;
}
