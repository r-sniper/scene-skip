export function parseTimestamp(input: string): number {
  const text = input.trim().replace(",", ".");
  const parts = text.split(":");
  if (!/^\d+(?::\d{2}){0,2}(?:\.\d{1,3})?$/.test(text)) {
    throw new Error("Use seconds, MM:SS, or HH:MM:SS, with optional milliseconds.");
  }
  const values = parts.map(Number);
  if (values.slice(1).some(value => value >= 60)) {
    throw new Error("Minutes and seconds after a colon must be below 60.");
  }
  const seconds = values.reduce((total, value) => total * 60 + value, 0);
  if (!Number.isFinite(seconds) || seconds > Number.MAX_SAFE_INTEGER / 1000) {
    throw new Error("The timestamp is too large.");
  }
  return seconds;
}

export function formatTimestamp(seconds: number): string {
  const milliseconds = Math.round(seconds * 1000);
  const hours = Math.floor(milliseconds / 3_600_000);
  const minutes = Math.floor(milliseconds / 60_000) % 60;
  const wholeSeconds = Math.floor(milliseconds / 1000) % 60;
  return `${String(hours).padStart(2, "0")}:${String(minutes).padStart(2, "0")}:${String(wholeSeconds).padStart(2, "0")}.${String(milliseconds % 1000).padStart(3, "0")}`;
}
