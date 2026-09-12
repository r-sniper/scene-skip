import test from "node:test";
import type { TestContext } from "node:test";
import assert from "node:assert/strict";
import { setImmediate } from "node:timers/promises";
import { NetflixPlayerAdapter } from "../src/platforms/netflix/player.ts";
import { PageSession } from "../src/content/page-session.ts";
import { SessionController } from "../src/content/controller.ts";

const url = "https://www.netflix.com/watch/1234";

class FakeVideo extends EventTarget {
  readyState = 4;
  duration = 600;
  paused = true;
  ended = false;
  seeking = false;
}

function netflixFixture(context: TestContext) {
  const video = new FakeVideo();
  const seeks: number[] = [];
  let positionMs = 8000;
  const api = {
    getCurrentTime: () => positionMs,
    seek(milliseconds: number) {
      seeks.push(milliseconds);
      positionMs = milliseconds;
      video.dispatchEvent(new Event("seeked"));
    }
  };
  const manager = { getAllPlayerSessionIds: () => ["session"], getVideoPlayerBySessionId: () => api };
  const pageWindow = { netflix: { appContext: { state: { playerApp: { getAPI: () => ({ videoPlayer: manager }) } } } } };
  const pageLocation = { href: url };
  const pageDocument = { querySelector: () => video };
  const globals = { window: pageWindow, location: pageLocation, document: pageDocument };
  for (const [name, value] of Object.entries(globals)) {
    const previous = Object.getOwnPropertyDescriptor(globalThis, name);
    Object.defineProperty(globalThis, name, { configurable: true, value });
    context.after(() => {
      if (previous) Object.defineProperty(globalThis, name, previous);
      else Reflect.deleteProperty(globalThis, name);
    });
  }
  return { video, api, manager, seeks, pageLocation, pageWindow, player: new NetflixPlayerAdapter(url) };
}

test("Netflix reads its API clock in seconds and the video playback state", async context => {
  const fixture = netflixFixture(context);
  fixture.api.getCurrentTime = () => 90_500;
  assert.deepEqual(await fixture.player.readPlayback(), { currentSeconds: 90.5, durationSeconds: 600, paused: true, ended: false });
  fixture.video.paused = false;
  fixture.video.ended = true;
  assert.deepEqual(await fixture.player.readPlayback(), { currentSeconds: 90.5, durationSeconds: 600, paused: false, ended: true });
});

test("Netflix seeks in milliseconds, returns seconds, and leaves pause state unchanged", async context => {
  const fixture = netflixFixture(context);
  assert.deepEqual(await fixture.player.seekTo(90.5), { requestedSeconds: 90.5, observedSeconds: 90.5 });
  assert.equal(fixture.video.paused, true);
  await fixture.player.seekTo(0);
  fixture.video.paused = false;
  await fixture.player.seekTo(600);
  assert.equal(fixture.video.paused, false);
  assert.deepEqual(fixture.seeks, [90_500, 0, 600_000]);
  await fixture.player.seekTo(600);
  assert.deepEqual(fixture.seeks, [90_500, 0, 600_000]);
});

test("a Netflix seek remains pending until the video reports seek completion", async context => {
  const fixture = netflixFixture(context);
  fixture.api.seek = milliseconds => {
    fixture.seeks.push(milliseconds);
    fixture.api.getCurrentTime = () => milliseconds;
  };
  let finished = false;
  const seek = fixture.player.seekTo(90).then(result => { finished = true; return result; });
  await setImmediate();
  assert.equal(finished, false);
  fixture.video.dispatchEvent(new Event("seeked"));
  assert.deepEqual(await seek, { requestedSeconds: 90, observedSeconds: 90 });
});

test("Netflix rejects unavailable players, invalid clocks, unloaded media and changed pages", async context => {
  const fixture = netflixFixture(context);
  fixture.manager.getAllPlayerSessionIds = () => [];
  await assert.rejects(fixture.player.readPlayback(), /one Netflix player/);
  fixture.manager.getAllPlayerSessionIds = () => ["session"];
  fixture.video.readyState = 0;
  await assert.rejects(fixture.player.readPlayback(), /Wait for/);
  fixture.video.readyState = 4;
  fixture.api.getCurrentTime = () => NaN;
  await assert.rejects(fixture.player.readPlayback(), /invalid playback/);
  fixture.pageLocation.href = "https://www.netflix.com/watch/5678";
  await assert.rejects(fixture.player.seekTo(10), /video changed/);
  fixture.pageLocation.href = url;
  Reflect.deleteProperty(fixture.pageWindow, "netflix");
  await assert.rejects(fixture.player.readPlayback(), /API unavailable/);
  assert.deepEqual(fixture.seeks, []);
});

test("invalid Netflix seek targets never reach the player", async context => {
  const fixture = netflixFixture(context);
  for (const seconds of [-1, NaN, Infinity, 601]) await assert.rejects(fixture.player.seekTo(seconds), /duration/);
  assert.deepEqual(fixture.seeks, []);
});

test("an uncompleted Netflix seek times out and fails", async context => {
  context.mock.timers.enable({ apis: ["setTimeout"] });
  const fixture = netflixFixture(context);
  fixture.api.seek = milliseconds => { fixture.seeks.push(milliseconds); };
  const failed = assert.rejects(fixture.player.seekTo(90), /did not finish seeking/);
  context.mock.timers.tick(10_000);
  await failed;
  assert.deepEqual(fixture.seeks, [90_000]);
});

test("Netflix seek API and media errors reject instead of reporting success", async context => {
  const fixture = netflixFixture(context);
  const failure = new Error("Seek API failed");
  fixture.api.seek = () => { throw failure; };
  await assert.rejects(fixture.player.seekTo(90), error => error === failure);
  fixture.api.seek = () => { fixture.video.dispatchEvent(new Event("error")); };
  await assert.rejects(fixture.player.seekTo(90), /video failed/);
  fixture.api.seek = () => { fixture.video.dispatchEvent(new Event("seeked")); };
  await assert.rejects(fixture.player.seekTo(90), /instead of 90s/);
});

test("the debug page command uses the Netflix player implementation", async context => {
  const fixture = netflixFixture(context);
  const result = await new PageSession(expectedUrl => new NetflixPlayerAdapter(expectedUrl)).debugSeek(90.5, url);
  assert.deepEqual(result, { ok: true, data: { requestedSeconds: 90.5, observedSeconds: 90.5 } });
  assert.deepEqual(fixture.seeks, [90_500]);
});

test("invalid file loads do not start a loop or prevent loading a valid file afterward", async context => {
  const fixture = netflixFixture(context);
  const start = context.mock.method(SessionController.prototype, "start", () => Promise.resolve());
  const session = new PageSession(expectedUrl => new NetflixPlayerAdapter(expectedUrl));
  const invalid = await session.loadFile("bad.srt", "bad", url);
  assert.ok(!invalid.ok);
  const overflow = await session.loadFile("long.srt", "1\n00:00:00,000 --> 00:11:00,000\nSong", url);
  assert.ok(!overflow.ok);
  assert.match(overflow.error.message, /duration/);
  assert.deepEqual(fixture.seeks, []);
  assert.equal(start.mock.callCount(), 0);
  const valid = await session.loadFile("cut.srt", "1\n00:01:30,000 --> 00:02:00,000\nSong", url);
  assert.ok(valid.ok);
  assert.equal(valid.data.file.filename, "cut.srt");
  assert.equal(start.mock.callCount(), 1);
});

test("file loading replies and restores its state before the first automatic seek finishes", async context => {
  context.mock.timers.enable({ apis: ["setTimeout"] });
  const fixture = netflixFixture(context);
  fixture.video.paused = false;
  fixture.api.getCurrentTime = () => 100_000;
  fixture.api.seek = milliseconds => {
    fixture.seeks.push(milliseconds);
    fixture.api.getCurrentTime = () => milliseconds;
  };
  const session = new PageSession(expectedUrl => new NetflixPlayerAdapter(expectedUrl));
  const loaded = await session.loadFile("cut.srt", "1\n00:01:30,000 --> 00:02:00,000\nSong", url);
  assert.ok(loaded.ok);
  assert.equal(loaded.data.file.filename, "cut.srt");
  assert.deepEqual(session.getFile(), loaded.data);
  await setImmediate();
  assert.deepEqual(fixture.seeks, [120_000]);
  const disabled = await session.setFileEnabled(false);
  assert.ok(disabled.ok);
  assert.equal(disabled.data.enabled, false);
  fixture.video.dispatchEvent(new Event("seeked"));
  await setImmediate();
  context.mock.timers.tick(250);
  await setImmediate();
  assert.equal(session.getFile().enabled, false);
  assert.equal(session.loadedFile?.filename, "cut.srt");
  assert.deepEqual(fixture.seeks, [120_000]);
});

test("file commands reject missing files and invalid toggles, and retain the file when toggled", async context => {
  const fixture = netflixFixture(context);
  context.mock.method(SessionController.prototype, "start", () => Promise.resolve());
  const session = new PageSession(expectedUrl => new NetflixPlayerAdapter(expectedUrl));
  assert.deepEqual(session.getFile(), { file: null, enabled: false, error: null });
  const missing = await session.setFileEnabled(true);
  assert.ok(!missing.ok);
  assert.match(missing.error.message, /Load an SRT/);
  const invalid = await Reflect.apply(session.setFileEnabled, session, ["false"]);
  assert.equal(invalid.ok, false);
  const loaded = await session.loadFile("cut.srt", "1\n00:01:30,000 --> 00:02:00,000\nSong", url);
  assert.ok(loaded.ok);
  for (const enabled of [false, true, false]) {
    const reply = await session.setFileEnabled(enabled);
    assert.ok(reply.ok);
    assert.deepEqual(reply.data, { ...loaded.data, enabled });
    assert.deepEqual(session.getFile(), reply.data);
  }
  assert.equal(fixture.video.paused, true);
});

test("a failed first skip preserves the loaded file and exposes the error without retrying", async context => {
  context.mock.timers.enable({ apis: ["setTimeout"] });
  const fixture = netflixFixture(context);
  fixture.video.paused = false;
  fixture.api.getCurrentTime = () => 100_000;
  fixture.api.seek = () => { throw new Error("Seek API failed"); };
  const log = context.mock.method(console, "error", () => {});
  const session = new PageSession(expectedUrl => new NetflixPlayerAdapter(expectedUrl));
  const loaded = await session.loadFile("cut.srt", "1\n00:01:30,000 --> 00:02:00,000\nSong", url);
  assert.ok(loaded.ok);
  await setImmediate();
  assert.equal(session.getFile().file?.filename, "cut.srt");
  assert.equal(session.getFile().error, "Seek API failed");
  assert.equal(log.mock.callCount(), 1);
  assert.ok((await session.setFileEnabled(false)).ok);
  const enabled = await session.setFileEnabled(true);
  assert.ok(!enabled.ok);
  assert.match(enabled.error.message, /Seek API failed.*Reload/);
  assert.equal(session.getFile().enabled, false);
  context.mock.timers.tick(1000);
  await setImmediate();
  assert.equal(log.mock.callCount(), 1);
});
