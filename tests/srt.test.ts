import test from "node:test";
import assert from "node:assert/strict";
import { parseSrt } from "../src/skipfiles/srt.ts";
import { SessionController } from "../src/content/controller.ts";
import type { SkipPlayer } from "../src/shared/contracts.ts";

test("ordinary SRT supports BOM, CRLF, milliseconds, Unicode and multiline reasons", () => {
  const text = "\uFEFF1\r\n00:00:00,125 --> 00:01:30,500\r\nSong — संगीत\r\nSecond line\r\n\r\n2\r\n01:10:00,000 --> 01:11:00,000\r\n<em>Reason stays text</em>\r\n";
  assert.deepEqual(parseSrt(text), [
    { startSeconds: 0.125, endSeconds: 90.5, reason: "Song — संगीत\nSecond line" },
    { startSeconds: 4200, endSeconds: 4260, reason: "<em>Reason stays text</em>" }
  ]);
});

test("empty or malformed SRT fails instead of producing an empty or partial file", () => {
  const valid = "1\n00:01:30,000 --> 00:02:00,000\nSong";
  for (const text of ["", "  ", "1", "Song\n00:01:30,000 --> 00:02:00,000\nReason", valid.replace("30,000", "60,000"), valid.replace("00:02:00,000", "00:01:30,000"), valid.replace("\nSong", ""), valid + "\n\n2\ninvalid\nScene"]) {
    assert.throws(() => parseSrt(text));
  }
});

test("loading a file constructs a ready controller without touching playback until tick", async () => {
  let reads = 0;
  const seeks: number[] = [];
  const player: SkipPlayer = {
    async readPlayback() {
      reads += 1;
      return { currentSeconds: 100, durationSeconds: 600, paused: false, ended: false };
    },
    async seekTo(seconds) {
      seeks.push(seconds);
      return { requestedSeconds: seconds, observedSeconds: seconds };
    }
  };
  assert.throws(() => SessionController.loadFile(player, "empty.srt", ""));
  const controller = SessionController.loadFile(player, "no-songs.srt", "1\n00:01:30,000 --> 00:02:00,000\nSong");
  assert.deepEqual(controller.file, { filename: "no-songs.srt", ranges: [{ startSeconds: 90, endSeconds: 120, reason: "Song" }] });
  assert.equal(reads, 0);
  await controller.tick();
  assert.deepEqual(seeks, [120]);
});
