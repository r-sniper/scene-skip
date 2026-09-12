import type { SkipRange } from "../shared/contracts.ts";
import { parseTimestamp } from "../shared/time.ts";

export function parseSrt(text: string): SkipRange[] {
  const normalized = text.replace(/^\uFEFF/, "").replace(/\r\n?/g, "\n").trim();
  if (!normalized) throw new Error("The SRT file is empty.");

  return normalized.split(/\n[\t ]*\n+/).map((block, index) => {
    const [sequence, timestamps, ...reasonLines] = block.split("\n");
    if (!/^\d+$/.test(sequence.trim())) throw new Error(`SRT entry ${index + 1} needs a sequence number.`);
    const match = timestamps?.trim().match(/^(\d{2,}:[0-5]\d:[0-5]\d,\d{3})\s+-->\s+(\d{2,}:[0-5]\d:[0-5]\d,\d{3})$/);
    if (!match) throw new Error(`SRT entry ${index + 1} needs HH:MM:SS,mmm --> HH:MM:SS,mmm timestamps.`);
    const startSeconds = parseTimestamp(match[1]);
    const endSeconds = parseTimestamp(match[2]);
    if (endSeconds <= startSeconds) throw new Error(`SRT entry ${index + 1} must end after it starts.`);
    const reason = reasonLines.join("\n").trim();
    if (!reason) throw new Error(`SRT entry ${index + 1} needs a reason.`);
    return { startSeconds, endSeconds, reason };
  });
}
