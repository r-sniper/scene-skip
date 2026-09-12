import type { SkipRange } from "../shared/contracts.ts";

export type SkipInterval = Pick<SkipRange, "startSeconds" | "endSeconds">;

export function prepareSkipIntervals(ranges: readonly SkipRange[], offsetSeconds: number): SkipInterval[] {
  if (ranges.length === 0) throw new Error("A skip file must contain at least one range.");
  if (!Number.isFinite(offsetSeconds)) throw new Error("The skip offset must be finite.");

  const shiftedRanges = ranges.map((range, index) => {
    if (!Number.isFinite(range.startSeconds) || !Number.isFinite(range.endSeconds) || range.startSeconds < 0 || range.endSeconds <= range.startSeconds) {
      throw new Error(`Skip range ${index + 1} must have a non-negative start and a later, finite end.`);
    }
    const startSeconds = range.startSeconds + offsetSeconds;
    const endSeconds = range.endSeconds + offsetSeconds;
    if (!Number.isFinite(startSeconds) || !Number.isFinite(endSeconds) || startSeconds < 0) {
      throw new Error(`The offset moves skip range ${index + 1} outside the supported timeline.`);
    }
    return { startSeconds, endSeconds };
  }).sort((left, right) => left.startSeconds - right.startSeconds);

  const intervals: SkipInterval[] = [];
  for (const range of shiftedRanges) {
    const previous = intervals.at(-1);
    if (previous && range.startSeconds <= previous.endSeconds) {
      previous.endSeconds = Math.max(previous.endSeconds, range.endSeconds);
    } else {
      intervals.push(range);
    }
  }
  return intervals;
}
