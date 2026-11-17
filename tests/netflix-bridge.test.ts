import test from "node:test";
import type { TestContext } from "node:test";
import assert from "node:assert/strict";
import { getEventListeners } from "node:events";
import { setImmediate } from "node:timers/promises";
import { build } from "esbuild";
import { installNetflixBridge } from "../src/platforms/netflix/bridge.ts";
import { NetflixPlayerProxy } from "../src/platforms/netflix/proxy.ts";
import { NETFLIX_PLAYER_CHANNEL } from "../src/platforms/netflix/protocol.ts";
import { readObject, readString } from "../src/shared/validation.ts";

const url = "https://www.netflix.com/watch/1234";
const origin = "https://www.netflix.com";

class FixtureWindow extends EventTarget {
  messages: Record<string, unknown>[] = [];

  postMessage(data: unknown, targetOrigin: string): void {
    assert.equal(targetOrigin, origin);
    this.messages.push(readObject(data));
    queueMicrotask(() => this.deliver(data));
  }

  deliver(data: unknown, senderOrigin = origin, source: unknown = this): void {
    const event = Object.assign(new Event("message"), { data, origin: senderOrigin, source });
    this.dispatchEvent(event);
  }
}

function fixture(context: TestContext) {
  const pageWindow = new FixtureWindow();
  const video = Object.assign(new EventTarget(), { readyState: 4, duration: 600, paused: true, ended: false, seeking: false });
  let positionMs = 8000;
  const seeks: number[] = [];
  const api = {
    getCurrentTime: () => positionMs,
    seek(milliseconds: number) {
      seeks.push(milliseconds);
      positionMs = milliseconds;
      video.dispatchEvent(new Event("seeked"));
    }
  };
  Object.assign(pageWindow, { netflix: { appContext: { state: { playerApp: { getAPI: () => ({ videoPlayer: {
    getAllPlayerSessionIds: () => ["session"], getVideoPlayerBySessionId: () => api
  } }) } } } } });
  const pageLocation = { href: url, origin };
  const globals = { window: pageWindow, location: pageLocation, document: { querySelector: () => video } };
  for (const [name, value] of Object.entries(globals)) {
    const previous = Object.getOwnPropertyDescriptor(globalThis, name);
    Object.defineProperty(globalThis, name, { configurable: true, value });
    context.after(() => {
      if (previous) Object.defineProperty(globalThis, name, previous);
      else Reflect.deleteProperty(globalThis, name);
    });
  }
  return { pageWindow, video, api, seeks, pageLocation, player: new NetflixPlayerProxy() };
}

test("the bridge installs once and exposes only player reads and seeks", async context => {
  const current = fixture(context);
  installNetflixBridge();
  installNetflixBridge();
  assert.equal(getEventListeners(current.pageWindow, "message").length, 1);
  assert.deepEqual(await current.player.readPlayback(), { currentSeconds: 8, durationSeconds: 600, paused: true, ended: false });
  assert.deepEqual(await current.player.seekTo(90.5), { requestedSeconds: 90.5, observedSeconds: 90.5 });
  assert.deepEqual(current.seeks, [90_500]);
  assert.equal(current.video.paused, true);
  assert.equal(getEventListeners(current.pageWindow, "message").length, 1);
  const requests = current.pageWindow.messages.filter(message => message.direction === "request");
  assert.deepEqual(requests.map(message => message.command), [
    { operation: "read", contentId: "1234" }, { operation: "seek", contentId: "1234", seconds: 90.5 }
  ]);
  assert.equal("__sceneSkipNetflix" in current.pageWindow, false);
  assert.equal("__sceneSkipNetflixDebug" in current.pageWindow, false);
});

test("player failures cross the bridge as failures and clean up pending listeners", async context => {
  const current = fixture(context);
  installNetflixBridge();
  current.api.seek = () => { throw new Error("Player seek failed"); };
  await assert.rejects(current.player.seekTo(90), /Player seek failed/);
  await assert.rejects(current.player.seekTo(601), /within the video's duration/);
  assert.equal(getEventListeners(current.pageWindow, "message").length, 1);
});

test("the bridge rejects unknown commands and mismatched titles without seeking", async context => {
  const current = fixture(context);
  installNetflixBridge();
  current.pageWindow.deliver({ channel: NETFLIX_PLAYER_CHANNEL, direction: "request", requestId: "bad-op", command: { operation: "loadFile", contentId: "1234" } });
  current.pageWindow.deliver({ channel: NETFLIX_PLAYER_CHANNEL, direction: "request", requestId: "other-title", command: { operation: "seek", contentId: "5678", seconds: 90 } });
  await setImmediate();
  const responses = current.pageWindow.messages.filter(message => message.direction === "response");
  const replies = responses.map(message => readObject(message.reply));
  assert.deepEqual(replies.map(reply => reply.ok), [false, false]);
  assert.match(readString(readObject(replies[0].error).message), /Unsupported/);
  assert.match(readString(readObject(replies[1].error).message), /video changed/);
  assert.deepEqual(current.seeks, []);
});

test("the proxy ignores unrelated replies but rejects malformed matching replies", async context => {
  const current = fixture(context);
  const pending = current.player.readPlayback();
  const request = current.pageWindow.messages[0];
  current.pageWindow.deliver({ channel: NETFLIX_PLAYER_CHANNEL, direction: "response", requestId: "unrelated", reply: { ok: true, data: {} } });
  current.pageWindow.deliver({ channel: NETFLIX_PLAYER_CHANNEL, direction: "response", requestId: request.requestId, reply: { ok: true, data: { currentSeconds: 10 } } }, "https://evil.test");
  assert.equal(getEventListeners(current.pageWindow, "message").length, 1);
  current.pageWindow.deliver({ channel: NETFLIX_PLAYER_CHANNEL, direction: "response", requestId: request.requestId, reply: { ok: true, data: { currentSeconds: NaN, durationSeconds: 600, paused: true, ended: false } } });
  await assert.rejects(pending, /non-negative, finite time/);
  assert.equal(getEventListeners(current.pageWindow, "message").length, 0);
});

test("a missing bridge reply times out without retrying", async context => {
  context.mock.timers.enable({ apis: ["setTimeout"] });
  const current = fixture(context);
  const rejected = assert.rejects(current.player.readPlayback(), /did not reply within 30 seconds/);
  context.mock.timers.tick(30_000);
  await rejected;
  assert.equal(current.pageWindow.messages.length, 1);
  assert.equal(getEventListeners(current.pageWindow, "message").length, 0);
});

test("a title change rejects an otherwise valid response to an old request", async context => {
  const current = fixture(context);
  const pending = current.player.readPlayback();
  const request = current.pageWindow.messages[0];
  current.pageLocation.href = "https://www.netflix.com/watch/5678";
  current.pageWindow.deliver({ channel: NETFLIX_PLAYER_CHANNEL, direction: "response", requestId: request.requestId, reply: { ok: true, data: { currentSeconds: 8, durationSeconds: 600, paused: true, ended: false } } });
  await assert.rejects(pending, /video changed/);
});

test("the MAIN bundle contains no file parser, controller, or file commands", async () => {
  const result = await build({ entryPoints: ["src/platforms/netflix/page.ts"], bundle: true, format: "iife", write: false, metafile: true });
  const inputs = Object.keys(result.metafile.inputs);
  assert.equal(inputs.some(input => input.startsWith("src/content/") || input.startsWith("src/skipfiles/")), false);
  assert.match(result.outputFiles[0].text, /scene-skip\.netflix\.player/);
  assert.doesNotMatch(result.outputFiles[0].text, /loadFile|parseSrt|__sceneSkipNetflixDebug/);
});
