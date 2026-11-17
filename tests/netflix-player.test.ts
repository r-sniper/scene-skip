import test from "node:test";
import type { TestContext } from "node:test";
import assert from "node:assert/strict";
import { setImmediate } from "node:timers/promises";
import { NetflixPlayerAdapter } from "../src/platforms/netflix/player.ts";
import { getNetflixContentId } from "../src/platforms/netflix/identity.ts";

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

test("Netflix content identity ignores query changes and rejects unrelated hosts and pages", async context => {
  const fixture = netflixFixture(context);
  fixture.pageLocation.href = url + "?trackId=next";
  assert.equal(getNetflixContentId(fixture.pageLocation.href), "1234");
  assert.equal((await fixture.player.readPlayback()).currentSeconds, 8);
  for (const address of ["https://www.netflix.com/browse", "http://www.netflix.com/watch/1234", "https://www.netflix.com.evil.test/watch/1234"]) {
    assert.equal(getNetflixContentId(address), null);
  }
});

test("a title change during a seek rejects its completion", async context => {
  const fixture = netflixFixture(context);
  fixture.api.seek = milliseconds => {
    fixture.api.getCurrentTime = () => milliseconds;
  };
  const seeking = fixture.player.seekTo(90);
  fixture.pageLocation.href = "https://www.netflix.com/watch/5678";
  fixture.video.dispatchEvent(new Event("seeked"));
  await assert.rejects(seeking, /video changed/);
});

test("concurrent adapters finish each observed seek before issuing the next", async context => {
  const fixture = netflixFixture(context);
  fixture.api.seek = milliseconds => {
    fixture.seeks.push(milliseconds);
    fixture.api.getCurrentTime = () => milliseconds;
  };
  const first = fixture.player.seekTo(90);
  const second = new NetflixPlayerAdapter(url).seekTo(120);
  assert.deepEqual(fixture.seeks, [90_000]);
  fixture.video.dispatchEvent(new Event("seeked"));
  assert.deepEqual(await first, { requestedSeconds: 90, observedSeconds: 90 });
  await setImmediate();
  assert.deepEqual(fixture.seeks, [90_000, 120_000]);
  fixture.video.dispatchEvent(new Event("seeked"));
  assert.deepEqual(await second, { requestedSeconds: 120, observedSeconds: 120 });
});
