import test from "node:test";
import assert from "node:assert/strict";
import { setImmediate } from "node:timers/promises";
import { SessionController } from "../src/content/controller.ts";
import type { PlaybackSnapshot, SeekObservation, SkipPlayer } from "../src/shared/contracts.ts";

const playback: PlaybackSnapshot = { currentSeconds: 100, durationSeconds: 600, paused: false, ended: false };

function createController(player: SkipPlayer): SessionController {
  return SessionController.loadFile(player, "cut.srt", "1\n00:01:30,000 --> 00:02:00,000\nSong");
}

test("the loop waits for the seek to finish, then waits 250 ms before its next tick", async context => {
  context.mock.timers.enable({ apis: ["setTimeout"] });
  const seekStarted = Promise.withResolvers<void>();
  const seekFinished = Promise.withResolvers<SeekObservation>();
  const failure = new Error("Player read failed");
  let reads = 0;
  const seeks: number[] = [];
  const player: SkipPlayer = {
    async readPlayback() {
      reads += 1;
      if (reads === 2) throw failure;
      return playback;
    },
    seekTo(seconds) {
      seeks.push(seconds);
      seekStarted.resolve();
      return seekFinished.promise;
    }
  };

  const loop = createController(player).start();
  const completed = assert.rejects(loop, error => error === failure);
  assert.equal(reads, 1);
  await seekStarted.promise;
  context.mock.timers.tick(1000);
  await setImmediate();
  assert.equal(reads, 1);
  assert.deepEqual(seeks, [120]);

  seekFinished.resolve({ requestedSeconds: 120, observedSeconds: 120 });
  await setImmediate();
  context.mock.timers.tick(249);
  await setImmediate();
  assert.equal(reads, 1);
  context.mock.timers.tick(1);
  await completed;
  assert.equal(reads, 2);
  assert.deepEqual(seeks, [120]);
});

test("the loop repeats after successful ticks even when no seek is needed", async context => {
  context.mock.timers.enable({ apis: ["setTimeout"] });
  const failure = new Error("Player unavailable");
  let reads = 0;
  const seeks: number[] = [];
  const player: SkipPlayer = {
    async readPlayback() {
      reads += 1;
      if (reads === 4) throw failure;
      return { ...playback, currentSeconds: 80 };
    },
    async seekTo(seconds) {
      seeks.push(seconds);
      return { requestedSeconds: seconds, observedSeconds: seconds };
    }
  };

  const loop = createController(player).start();
  const completed = assert.rejects(loop, error => error === failure);
  await setImmediate();
  assert.equal(reads, 1);
  for (const expectedReads of [2, 3, 4]) {
    context.mock.timers.tick(250);
    await setImmediate();
    assert.equal(reads, expectedReads);
  }
  await completed;
  assert.deepEqual(seeks, []);
});

test("read and seek errors end the loop without scheduling another tick", async context => {
  context.mock.timers.enable({ apis: ["setTimeout"] });
  for (const failingOperation of ["read", "seek"]) {
    const failure = new Error(failingOperation + " failed");
    let reads = 0;
    let seeks = 0;
    const player: SkipPlayer = {
      async readPlayback() {
        reads += 1;
        if (failingOperation === "read") throw failure;
        return playback;
      },
      async seekTo() {
        seeks += 1;
        throw failure;
      }
    };

    await assert.rejects(createController(player).start(), error => error === failure);
    context.mock.timers.tick(1000);
    await setImmediate();
    assert.equal(reads, 1);
    assert.equal(seeks, failingOperation === "seek" ? 1 : 0);
  }
});

test("disabling skips retains the file and leaves playback untouched; enabling resumes skipping", async () => {
  let reads = 0;
  const seeks: number[] = [];
  const player: SkipPlayer = {
    async readPlayback() { reads += 1; return playback; },
    async seekTo(seconds) { seeks.push(seconds); return { requestedSeconds: seconds, observedSeconds: seconds }; }
  };
  const controller = createController(player);
  const file = controller.file;
  controller.setEnabled(false);
  assert.equal(await controller.tick(), null);
  assert.equal(reads, 1);
  assert.deepEqual(controller.readSkipState(), { file, enabled: false, error: null });
  controller.setEnabled(true);
  await controller.tick();
  assert.equal(reads, 2);
  assert.deepEqual(seeks, [120]);
  assert.equal(controller.file, file);
});

test("disabling during a pending playback read prevents that tick from seeking", async () => {
  const pending = Promise.withResolvers<PlaybackSnapshot>();
  const seeks: number[] = [];
  const player: SkipPlayer = {
    readPlayback: () => pending.promise,
    async seekTo(seconds) { seeks.push(seconds); return { requestedSeconds: seconds, observedSeconds: seconds }; }
  };
  const controller = createController(player);
  const tick = controller.tick();
  controller.setEnabled(false);
  pending.resolve(playback);
  assert.equal(await tick, null);
  assert.deepEqual(seeks, []);
});

test("validation checks the file's duration without requesting a skip", async () => {
  const seeks: number[] = [];
  const player: SkipPlayer = {
    async readPlayback() { return playback; },
    async seekTo(seconds) { seeks.push(seconds); return { requestedSeconds: seconds, observedSeconds: seconds }; }
  };
  await createController(player).validate();
  assert.deepEqual(seeks, []);
  player.readPlayback = async () => ({ ...playback, durationSeconds: 119 });
  await assert.rejects(createController(player).validate(), /duration/);
});
