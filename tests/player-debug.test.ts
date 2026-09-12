import test from "node:test";
import assert from "node:assert/strict";
import { setImmediate } from "node:timers/promises";
import { PlayerDebugController } from "../src/content/player-debug.ts";
import type { DebugDisplay, DebugOptions, PlaybackReader, PlaybackSnapshot, SkipFile, SkipRange } from "../src/shared/contracts.ts";

const url = "https://www.netflix.com/watch/1234";
const off: DebugOptions = { showTimestamp: false, showSkipRanges: false };
const clock: DebugOptions = { showTimestamp: true, showSkipRanges: false };
const both: DebugOptions = { showTimestamp: true, showSkipRanges: true };
const playback: PlaybackSnapshot = { currentSeconds: 12.5, durationSeconds: 600, paused: true, ended: false };
const file: SkipFile = { filename: "cut.srt", ranges: [{ startSeconds: 90, endSeconds: 120, reason: "Scene" }] };

function fixture() {
  let loadedFile: SkipFile | null = null;
  const frames: { playback: PlaybackSnapshot; options: DebugOptions; ranges: readonly SkipRange[] }[] = [];
  const errors: string[] = [];
  let clears = 0;
  let reads = 0;
  const player: PlaybackReader = {
    async readPlayback() { reads += 1; return playback; }
  };
  const display: DebugDisplay = {
    render(playback, options, ranges) { frames.push({ playback, options, ranges }); },
    clear() { clears += 1; },
    showError(message) { errors.push(message); }
  };
  const controller = new PlayerDebugController(expected => {
    assert.equal(expected, url);
    return player;
  }, () => loadedFile, display);
  return { controller, player, display, frames, errors, get reads() { return reads; }, get clears() { return clears; }, load: () => { loadedFile = file; } };
}

test("overlays begin off; the clock works without a file and updates observed paused time", async context => {
  context.mock.timers.enable({ apis: ["setTimeout"] });
  const state = fixture();
  assert.deepEqual(state.controller.readState(), { options: off, error: null });
  const enabled = await state.controller.configure(clock, url);
  assert.deepEqual(enabled, { ok: true, data: { options: clock, error: null } });
  assert.deepEqual(state.frames, [{ playback, options: clock, ranges: [] }]);
  state.player.readPlayback = async () => ({ ...playback, currentSeconds: 42.25 });
  context.mock.timers.tick(100);
  await setImmediate();
  assert.equal(state.frames[1].playback.currentSeconds, 42.25);
  assert.equal(state.frames[1].playback.paused, true);
  await state.controller.configure(off, url);
  context.mock.timers.tick(1000);
  await setImmediate();
  assert.equal(state.frames.length, 2);
  assert.equal(state.clears, 1);
});

test("skip markers require a file and use its actual ranges; options remain independent", async context => {
  context.mock.timers.enable({ apis: ["setTimeout"] });
  const state = fixture();
  const unavailable = await state.controller.configure(both, url);
  assert.ok(!unavailable.ok);
  assert.match(unavailable.error.message, /Load a skip file/);
  assert.equal(state.reads, 0);
  assert.deepEqual(state.controller.readState().options, off);
  state.load();
  await state.controller.configure(both, url);
  assert.deepEqual(state.frames[0].ranges, file.ranges);
  const onlySegments = { showTimestamp: false, showSkipRanges: true };
  await state.controller.configure(onlySegments, url);
  assert.deepEqual(state.controller.readState(), { options: onlySegments, error: null });
  context.mock.timers.tick(100);
  await setImmediate();
  assert.equal(state.frames.length, 3);
});

test("failed initial reads or renders reject without claiming settings were applied", async () => {
  const state = fixture();
  state.player.readPlayback = async () => { throw new Error("Player unavailable"); };
  assert.deepEqual(await state.controller.configure(clock, url), { ok: false, error: { code: "REQUEST_FAILED", message: "Player unavailable" } });
  state.player.readPlayback = async () => playback;
  state.display.render = () => { throw new Error("Player container missing"); };
  const failed = await state.controller.configure(clock, url);
  assert.ok(!failed.ok);
  assert.match(failed.error.message, /container missing/);
  assert.deepEqual(state.controller.readState().options, off);
});

test("later player failures stop updates and remain visible when settings are read again", async context => {
  context.mock.timers.enable({ apis: ["setTimeout"] });
  const state = fixture();
  await state.controller.configure(clock, url);
  state.player.readPlayback = async () => { throw new Error("Video changed"); };
  context.mock.timers.tick(100);
  await setImmediate();
  assert.deepEqual(state.errors, ["Video changed"]);
  assert.equal(state.controller.readState().error, "Video changed");
  context.mock.timers.tick(1000);
  await setImmediate();
  assert.deepEqual(state.errors, ["Video changed"]);
  assert.equal(state.frames.length, 1);
  assert.ok((await state.controller.configure(off, url)).ok);
  assert.equal(state.controller.readState().error, null);
});

test("turning overlays off while a read is pending cannot resurrect the display or loop", async context => {
  context.mock.timers.enable({ apis: ["setTimeout"] });
  const state = fixture();
  await state.controller.configure(clock, url);
  const pending = Promise.withResolvers<PlaybackSnapshot>();
  state.player.readPlayback = () => pending.promise;
  context.mock.timers.tick(100);
  await state.controller.configure(off, url);
  pending.resolve({ ...playback, currentSeconds: 30 });
  await setImmediate();
  context.mock.timers.tick(1000);
  await setImmediate();
  assert.equal(state.frames.length, 1);
  assert.equal(state.clears, 1);
  assert.deepEqual(state.controller.readState().options, off);
});

test("invalid settings at the injected entry point are rejected", async () => {
  const state = fixture();
  const result = await Reflect.apply(state.controller.configure, state.controller, [{ showTimestamp: "yes", showSkipRanges: false }, url]);
  assert.equal(result.ok, false);
  assert.match(result.error.message, /booleans/);
  assert.equal(state.reads, 0);
});
