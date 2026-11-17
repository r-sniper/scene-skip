import test from "node:test";
import type { TestContext } from "node:test";
import assert from "node:assert/strict";
import { setImmediate } from "node:timers/promises";
import { SessionController } from "../src/content/controller.ts";
import type { PlaybackSnapshot, Player, SeekObservation } from "../src/shared/contracts.ts";

const srt = "1\n00:01:30,000 --> 00:02:00,000\nSong";
const empty = { file: null, enabled: false, error: null };

function fixture(context: TestContext) {
  context.mock.timers.enable({ apis: ["setTimeout"] });
  let contentId: string | null = "1234";
  const playback: PlaybackSnapshot = { currentSeconds: 100, durationSeconds: 600, paused: false, ended: false };
  let reads = 0;
  const seeks: number[] = [];
  const player: Player = {
    async readPlayback() { reads += 1; return { ...playback }; },
    async seekTo(seconds) {
      seeks.push(seconds);
      playback.currentSeconds = seconds;
      return { requestedSeconds: seconds, observedSeconds: seconds };
    }
  };
  const controller = new SessionController(player, () => contentId);
  return { controller, player, playback, seeks, get reads() { return reads; }, changeTitle: (next: string | null) => { contentId = next; } };
}

test("the common loop waits for seek completion and then 250 ms before reading again", async context => {
  const state = fixture(context);
  const started = Promise.withResolvers<void>();
  const finished = Promise.withResolvers<SeekObservation>();
  state.player.seekTo = seconds => { state.seeks.push(seconds); started.resolve(); return finished.promise; };
  const loaded = await state.controller.loadFile("cut.srt", srt);
  assert.equal(loaded.file.filename, "cut.srt");
  await started.promise;
  assert.equal(state.reads, 2);
  context.mock.timers.tick(1000);
  await setImmediate();
  assert.equal(state.reads, 2);
  finished.resolve({ requestedSeconds: 120, observedSeconds: 120 });
  state.playback.currentSeconds = 120;
  await setImmediate();
  context.mock.timers.tick(249);
  await setImmediate();
  assert.equal(state.reads, 2);
  context.mock.timers.tick(1);
  await setImmediate();
  assert.equal(state.reads, 3);
  assert.deepEqual(state.seeks, [120]);
});

test("file state is returned before the first automatic seek finishes", async context => {
  const state = fixture(context);
  const finished = Promise.withResolvers<SeekObservation>();
  state.player.seekTo = seconds => { state.seeks.push(seconds); return finished.promise; };
  const loaded = await state.controller.loadFile("cut.srt", srt);
  assert.deepEqual(state.controller.getFile(), loaded);
  assert.equal(state.controller.loadedFile, loaded.file);
  await setImmediate();
  assert.deepEqual(state.seeks, [120]);
  state.controller.setFileEnabled(false);
  finished.resolve({ requestedSeconds: 120, observedSeconds: 120 });
  await setImmediate();
  assert.equal(state.controller.getFile().enabled, false);
});

test("the loop repeats after successful reads outside ranges and stops on a read failure", async context => {
  const state = fixture(context);
  state.playback.currentSeconds = 80;
  await state.controller.loadFile("cut.srt", srt);
  await setImmediate();
  assert.equal(state.reads, 2);
  for (const expectedReads of [3, 4]) {
    context.mock.timers.tick(250);
    await setImmediate();
    assert.equal(state.reads, expectedReads);
  }
  state.player.readPlayback = async () => { throw new Error("Player unavailable"); };
  context.mock.timers.tick(250);
  await setImmediate();
  assert.equal(state.controller.getFile().error, "Player unavailable");
  assert.deepEqual(state.seeks, []);
  state.player.readPlayback = async () => assert.fail("A failed loop retried");
  context.mock.timers.tick(1000);
  await setImmediate();
  assert.equal(state.controller.getFile().error, "Player unavailable");
});

test("disabled skipping retains the cut and checks playback without seeking", async context => {
  const state = fixture(context);
  state.playback.currentSeconds = 80;
  const loaded = await state.controller.loadFile("cut.srt", srt);
  await setImmediate();
  state.controller.setFileEnabled(false);
  state.playback.currentSeconds = 100;
  context.mock.timers.tick(250);
  await setImmediate();
  assert.deepEqual(state.controller.getFile(), { ...loaded, enabled: false });
  assert.equal(state.reads, 3);
  assert.deepEqual(state.seeks, []);
  state.controller.setFileEnabled(true);
  context.mock.timers.tick(250);
  await setImmediate();
  assert.deepEqual(state.seeks, [120]);
});

test("disabling during an awaited read prevents that automatic seek", async context => {
  const state = fixture(context);
  let reads = 0;
  const pending = Promise.withResolvers<PlaybackSnapshot>();
  state.player.readPlayback = async () => {
    reads += 1;
    return reads === 1 ? { ...state.playback } : pending.promise;
  };
  await state.controller.loadFile("cut.srt", srt);
  state.controller.setFileEnabled(false);
  pending.resolve({ ...state.playback });
  await setImmediate();
  assert.deepEqual(state.seeks, []);
  assert.equal(state.controller.getFile().enabled, false);
});

test("invalid files and runtime bounds reject without leaving a loaded session", async context => {
  const state = fixture(context);
  await assert.rejects(state.controller.loadFile("bad.srt", "bad"), /sequence number/);
  assert.equal(state.reads, 0);
  assert.deepEqual(state.controller.getFile(), empty);
  state.playback.durationSeconds = 119;
  await assert.rejects(state.controller.loadFile("long.srt", srt), /beyond the video's/);
  assert.deepEqual(state.controller.getFile(), empty);
  state.playback.durationSeconds = 600;
  const loaded = await state.controller.loadFile("cut.srt", srt);
  assert.equal(loaded.file.filename, "cut.srt");
});

test("concurrent file loads are rejected and only one controller loop starts", async context => {
  const state = fixture(context);
  const pending = Promise.withResolvers<PlaybackSnapshot>();
  state.player.readPlayback = () => pending.promise;
  const first = state.controller.loadFile("first.srt", srt);
  await assert.rejects(state.controller.loadFile("second.srt", srt), /already being loaded/);
  pending.resolve({ ...state.playback, paused: true });
  const loaded = await first;
  assert.equal(loaded.file.filename, "first.srt");
  await assert.rejects(state.controller.loadFile("second.srt", srt), /already been loaded/);
  assert.deepEqual(state.seeks, []);
});

test("a title change clears a disabled cut before unavailable player access", async context => {
  const state = fixture(context);
  state.playback.currentSeconds = 80;
  await state.controller.loadFile("cut.srt", srt);
  await setImmediate();
  state.controller.setFileEnabled(false);
  state.changeTitle("5678");
  state.player.readPlayback = async () => assert.fail("Old title accessed the player after navigation");
  assert.deepEqual(state.controller.getFile(), empty);
  assert.equal(state.controller.loadedFile, null);
  assert.throws(() => state.controller.setFileEnabled(true), /Load an SRT/);
  context.mock.timers.tick(250);
  await setImmediate();
  assert.deepEqual(state.controller.getFile(), empty);
});

test("navigation during a pending read cannot issue an old-title seek", async context => {
  const state = fixture(context);
  let reads = 0;
  const pending = Promise.withResolvers<PlaybackSnapshot>();
  state.player.readPlayback = async () => {
    reads += 1;
    return reads === 1 ? { ...state.playback } : pending.promise;
  };
  await state.controller.loadFile("cut.srt", srt);
  state.changeTitle("5678");
  pending.resolve({ ...state.playback });
  await setImmediate();
  assert.deepEqual(state.seeks, []);
  assert.deepEqual(state.controller.getFile(), empty);
});

test("navigation during initial validation rejects the load and releases its loading state", async context => {
  const state = fixture(context);
  const pending = Promise.withResolvers<PlaybackSnapshot>();
  state.player.readPlayback = () => pending.promise;
  const first = state.controller.loadFile("old.srt", srt);
  state.changeTitle("5678");
  pending.resolve({ ...state.playback });
  await assert.rejects(first, /video changed/);
  assert.deepEqual(state.controller.getFile(), empty);
  state.player.readPlayback = async () => ({ ...state.playback, paused: true });
  assert.equal((await state.controller.loadFile("new.srt", srt)).file.filename, "new.srt");
});

test("an old-title seek failure cannot stop a newly loaded title's loop", async context => {
  const state = fixture(context);
  const started = Promise.withResolvers<void>();
  const pending = Promise.withResolvers<SeekObservation>();
  state.player.seekTo = () => { started.resolve(); return pending.promise; };
  await state.controller.loadFile("old.srt", srt);
  await started.promise;
  state.changeTitle("5678");
  assert.deepEqual(state.controller.getFile(), empty);
  state.playback.paused = true;
  const loaded = await state.controller.loadFile("new.srt", srt);
  pending.reject(new Error("Old video changed"));
  await setImmediate();
  assert.deepEqual(state.controller.getFile(), loaded);
});

test("seek failures remain visible and enabling does not retry a stopped loop", async context => {
  const state = fixture(context);
  let seeks = 0;
  state.player.seekTo = async () => { seeks += 1; throw new Error("Seek API failed"); };
  await state.controller.loadFile("cut.srt", srt);
  await setImmediate();
  assert.equal(state.controller.getFile().error, "Seek API failed");
  assert.equal(state.controller.loadedFile?.filename, "cut.srt");
  assert.throws(() => state.controller.setFileEnabled(true), /Seek API failed.*Reload/);
  state.controller.setFileEnabled(false);
  context.mock.timers.tick(1000);
  await setImmediate();
  assert.equal(seeks, 1);
  state.changeTitle("5678");
  assert.deepEqual(state.controller.getFile(), empty);
});

test("manual debug seeking and playback reads use the common player interface", async context => {
  const state = fixture(context);
  assert.deepEqual(await state.controller.debugSeek(90.5), { requestedSeconds: 90.5, observedSeconds: 90.5 });
  assert.equal((await state.controller.readPlayback()).currentSeconds, 90.5);
  assert.deepEqual(state.controller.getFile(), empty);
  state.changeTitle(null);
  await assert.rejects(state.controller.debugSeek(10), /supported movie/);
  await assert.rejects(state.controller.readPlayback(), /supported movie/);
});

test("an automatic read spanning a completed manual seek cannot seek from its stale position", async context => {
  const state = fixture(context);
  state.playback.currentSeconds = 80;
  const pendingRead = Promise.withResolvers<PlaybackSnapshot>();
  let reads = 0;
  state.player.readPlayback = async () => {
    reads += 1;
    return reads === 2 ? pendingRead.promise : { ...state.playback };
  };
  await state.controller.loadFile("cut.srt", srt);
  await state.controller.debugSeek(300);
  pendingRead.resolve({ ...state.playback, currentSeconds: 100 });
  await setImmediate();
  assert.deepEqual(state.seeks, [300]);
  context.mock.timers.tick(250);
  await setImmediate();
  assert.deepEqual(state.seeks, [300]);
  assert.equal(state.controller.getFile().error, null);
});

test("automatic skipping waits until all pending manual seeks finish", async context => {
  const state = fixture(context);
  state.playback.currentSeconds = 80;
  await state.controller.loadFile("cut.srt", srt);
  await setImmediate();
  const first = Promise.withResolvers<SeekObservation>();
  const second = Promise.withResolvers<SeekObservation>();
  state.player.seekTo = seconds => {
    state.seeks.push(seconds);
    return seconds === 90 ? first.promise : second.promise;
  };
  const firstSeek = state.controller.debugSeek(90);
  const secondSeek = state.controller.debugSeek(100);
  first.resolve({ requestedSeconds: 90, observedSeconds: 90 });
  await firstSeek;
  state.playback.currentSeconds = 100;
  context.mock.timers.tick(250);
  await setImmediate();
  assert.deepEqual(state.seeks, [90, 100]);
  state.playback.currentSeconds = 300;
  second.resolve({ requestedSeconds: 100, observedSeconds: 100 });
  await secondSeek;
  context.mock.timers.tick(250);
  await setImmediate();
  assert.deepEqual(state.seeks, [90, 100]);
});
