import test from "node:test";
import assert from "node:assert/strict";
import { SkipEngine } from "../src/content/skip-engine.ts";
import { SessionController } from "../src/content/controller.ts";
import { createSessionAdapter } from "../src/platforms/session-adapter.ts";
import type { PlaybackSnapshot, Platform, SeekObservation, SkipPlayer, SkipRange } from "../src/shared/contracts.ts";

class FakePlayer implements SkipPlayer {
  playback: PlaybackSnapshot;
  reads = 0;
  seeks: number[] = [];

  constructor(currentSeconds: number) {
    this.playback = { currentSeconds, durationSeconds: 600, paused: false, ended: false };
  }

  async readPlayback(): Promise<PlaybackSnapshot> {
    this.reads += 1;
    return { ...this.playback };
  }

  async seekTo(seconds: number): Promise<SeekObservation> {
    this.seeks.push(seconds);
    this.playback.currentSeconds = seconds;
    return { requestedSeconds: seconds, observedSeconds: seconds };
  }
}

function range(startSeconds: number, endSeconds: number): SkipRange {
  return { startSeconds, endSeconds, reason: "Song" };
}

function createEngine(player: SkipPlayer, ranges: readonly SkipRange[], offsetSeconds = 0): SkipEngine {
  return new SkipEngine(player, ranges, offsetSeconds);
}

test("an engine requires a non-empty range list", () => {
  const player = new FakePlayer(90);
  assert.throws(() => new SkipEngine(player, []), /at least one range/);
  assert.equal(player.reads, 0);
  assert.deepEqual(player.seeks, []);
});

test("ranges include their start and exclude their end, including fractional seconds", async () => {
  for (const currentSeconds of [89.999, 90, 90.001, 119.999, 120, 120.001]) {
    const player = new FakePlayer(currentSeconds);
    const engine = createEngine(player, [range(90, 120)]);
    const result = await engine.tick();
    const expected = currentSeconds >= 90 && currentSeconds < 120;
    assert.deepEqual(player.seeks, expected ? [120] : []);
    assert.equal(result?.observedSeconds ?? null, expected ? 120 : null);
  }
});

test("a range can start at zero and end exactly at the video duration", async () => {
  const player = new FakePlayer(0);
  const engine = createEngine(player, [range(0, 600)]);
  assert.equal((await engine.tick())?.requestedSeconds, 600);
  assert.equal(await engine.tick(), null);
  assert.deepEqual(player.seeks, [600]);
});

test("paused and ended playback stay untouched, and resuming inside a range skips", async () => {
  const player = new FakePlayer(100);
  const engine = createEngine(player, [range(90, 120)]);
  player.playback.paused = true;
  assert.equal(await engine.tick(), null);
  assert.equal(player.playback.currentSeconds, 100);
  assert.equal(player.playback.paused, true);
  player.playback.paused = false;
  player.playback.ended = true;
  assert.equal(await engine.tick(), null);
  assert.deepEqual(player.seeks, []);
  player.playback.ended = false;
  await engine.tick();
  assert.deepEqual(player.seeks, [120]);
  assert.equal(player.playback.paused, false);
});

test("later skips use the original timeline and rewinding allows a range to skip again", async () => {
  const player = new FakePlayer(100);
  const engine = createEngine(player, [range(90, 120), range(200, 240)]);
  await engine.tick();
  player.playback.currentSeconds = 190;
  assert.equal(await engine.tick(), null);
  player.playback.currentSeconds = 210;
  await engine.tick();
  player.playback.currentSeconds = 95;
  await engine.tick();
  assert.deepEqual(player.seeks, [120, 240, 120]);
});

test("unsorted, overlapping and touching ranges become one seek without changing the file", async () => {
  const ranges = [range(120, 140), range(95, 105), range(80, 100), range(100, 120)];
  const original = structuredClone(ranges);
  const player = new FakePlayer(85);
  const engine = createEngine(player, ranges);
  await engine.tick();
  assert.equal(await engine.tick(), null);
  assert.deepEqual(player.seeks, [140]);
  assert.deepEqual(ranges, original);
});

test("positive and negative offsets shift the skip range", async () => {
  for (const offset of [-10, 10]) {
    const player = new FakePlayer(90 + offset);
    const ranges = [range(90, 120)];
    const engine = createEngine(player, ranges, offset);
    await engine.tick();
    assert.deepEqual(player.seeks, [120 + offset]);
    assert.deepEqual(ranges, [range(90, 120)]);
  }
});

test("invalid ranges and offsets fail visibly", () => {
  const invalidInputs = [
    { ranges: [range(-1, 10)], offset: 0 },
    { ranges: [range(10, 10)], offset: 0 },
    { ranges: [range(20, 10)], offset: 0 },
    { ranges: [range(NaN, 10)], offset: 0 },
    { ranges: [range(0, Infinity)], offset: 0 },
    { ranges: [range(0, NaN)], offset: 0 },
    { ranges: [range(10, 20)], offset: -11 },
    { ranges: [range(10, 20)], offset: Infinity },
    { ranges: [range(10, 20)], offset: NaN }
  ];
  for (const input of invalidInputs) {
    assert.throws(() => new SkipEngine(new FakePlayer(100), input.ranges, input.offset));
  }
});

test("an out-of-runtime range rejects the plan before seeking", async () => {
  const player = new FakePlayer(100);
  const engine = createEngine(player, [range(90, 120), range(580, 601)]);
  await assert.rejects(engine.tick(), /beyond the video's 600s duration/);
  assert.deepEqual(player.seeks, []);
});

test("player read and seek failures propagate unchanged", async () => {
  for (const operation of ["readPlayback", "seekTo"] as const) {
    const player = new FakePlayer(100);
    const failure = new Error(operation + " failed");
    player[operation] = async () => { throw failure; };
    const engine = createEngine(player, [range(90, 120)]);
    await assert.rejects(engine.tick(), error => error === failure);
  }
});

test("the controller tick delegates playback work to the engine", async () => {
  const player = new FakePlayer(100);
  const controller = SessionController.loadFile(player, "cut.srt", "1\n00:01:30,000 --> 00:02:00,000\nSong");
  assert.equal((await controller.tick())?.requestedSeconds, 120);
  assert.deepEqual(player.seeks, [120]);
});

test("Prime and YouTube players remain explicit stubs when supplied to the engine", async () => {
  const platforms: Platform[] = ["prime", "youtube"];
  for (const platform of platforms) {
    const engine = createEngine(createSessionAdapter(platform, "https://example.com"), [range(90, 120)]);
    await assert.rejects(engine.tick(), { code: "NOT_IMPLEMENTED" });
  }
});
