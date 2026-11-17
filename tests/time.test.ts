import test from "node:test";
import assert from "node:assert/strict";
import { formatTimestamp, parseTimestamp } from "../src/shared/time.ts";

test("debug timestamps support seconds, minutes, hours, and SRT-style fractions", () => {
  for (const [input, expected] of [["0", 0], ["90", 90], ["01:30", 90], ["90:00", 5400], ["01:02:03.125", 3723.125], [" 00:01:30,500 ", 90.5]] as const) {
    assert.equal(parseTimestamp(input), expected);
  }
});

test("invalid user input cannot become a seek", () => {
  for (const input of ["", "-10", "NaN", "Infinity", "1:60", "1:60:00", "1:2", "1:02:03:04", "2.0001", "a:20"]) {
    assert.throws(() => parseTimestamp(input));
  }
});

test("display preserves milliseconds and carries rounded values", () => {
  assert.equal(formatTimestamp(3723.125), "01:02:03.125");
  assert.equal(formatTimestamp(59.9999), "00:01:00.000");
});
