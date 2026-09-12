import test from "node:test";
import assert from "node:assert/strict";
import { runInNewContext } from "node:vm";
import { seekHtmlVideo } from "../src/platforms/html-video.ts";
import { route } from "../src/background/router.ts";
import { getPlatform, identifyPlatform, resolvePlatform } from "../src/platforms/registry.ts";
import { getPlatformInfo, identifyPlatformInfo } from "../src/platforms/catalog.ts";
import { createSessionAdapter } from "../src/platforms/session-adapter.ts";
import { Command } from "../src/shared/commands.ts";
import type { Platform, Reply, SeekObservation } from "../src/shared/contracts.ts";
import type { Request } from "../src/shared/messages.ts";

const youtubeUrl = "https://www.youtube.com/watch?v=fixture";
const selectors = { video: "video", advertisement: "#fixture-ad" };

function media(overrides = {}) {
  return { currentTime: 8, duration: 600, readyState: 1, paused: true, getBoundingClientRect: () => ({ width: 640, height: 360 }), ...overrides };
}

async function executeSerializedSeekProbe<Args extends unknown[]>(fn: (...args: Args) => Promise<Reply<SeekObservation>>, args: Args, globals: object): Promise<Reply<SeekObservation>> {
  const result: Reply<SeekObservation> = await runInNewContext(`(${fn.toString()})(...args)`, {
    args, setTimeout: (callback: () => void) => callback(), ...globals
  });
  return structuredClone(result);
}

function htmlContext(videos: ReturnType<typeof media>[], ad = false, url = youtubeUrl) {
  return { location: { href: url }, document: { querySelector: () => ad ? {} : null, querySelectorAll: () => videos } };
}

test("HTML seek selects the visible player, accepts zero, and preserves pause", async () => {
  const hidden = media({ getBoundingClientRect: () => ({ width: 0, height: 0 }) });
  const video = media();
  const result = await executeSerializedSeekProbe(seekHtmlVideo, [0, selectors, youtubeUrl], htmlContext([hidden, video]));
  assert.ok(result.ok);
  assert.equal(result.data.observedSeconds, 0);
  assert.equal(video.currentTime, 0);
  assert.equal(video.paused, true);
  assert.equal(hidden.currentTime, 8);
});

test("HTML seek reports errors without moving the player", async () => {
  const scenarios = [
    { videos: [], seconds: 50 },
    { videos: [media(), media()], seconds: 50 },
    { videos: [media()], seconds: 600 },
    { videos: [media({ duration: Infinity })], seconds: 50 },
    { videos: [media()], seconds: 50, ad: true },
    { videos: [media()], seconds: 50, url: "https://www.youtube.com/watch?v=another" }
  ];
  for (const scenario of scenarios) {
    const result = await executeSerializedSeekProbe(seekHtmlVideo, [scenario.seconds, selectors, youtubeUrl], htmlContext(scenario.videos, scenario.ad, scenario.url));
    assert.ok(!result.ok);
    assert.equal(result.error.code, "SEEK_FAILED");
    for (const video of scenario.videos) assert.equal(video.currentTime, 8);
  }
});

test("platform mismatch and unsupported YouTube surfaces are rejected", () => {
  assert.throws(() => resolvePlatform("netflix", youtubeUrl));
  assert.throws(() => resolvePlatform("youtube", "https://www.youtube.com/shorts/fixture"));
  assert.throws(() => resolvePlatform("netflix", "https://www.netflix.com.evil.example/watch/1234"));
  assert.doesNotThrow(() => resolvePlatform("prime", "https://www.primevideo.com/detail/fixture"));
});

test("worker routes Netflix commands to their execution world and original tab", async () => {
  const previous = Object.getOwnPropertyDescriptor(globalThis, "chrome");
  const injections: chrome.scripting.ScriptInjection<unknown[], unknown>[] = [];
  const url = "https://www.netflix.com/watch/1234";
  let result: Reply<unknown> = { ok: true, data: { requestedSeconds: 90, observedSeconds: 90 } };
  Object.defineProperty(globalThis, "chrome", { configurable: true, value: {
    tabs: { get: async () => ({ url }) },
    scripting: { executeScript: async (input: chrome.scripting.ScriptInjection<unknown[], unknown>) => {
      injections.push(input);
      return [{ result }];
    } }
  } });
  try {
    assert.equal((await route({ type: Command.DebugSeek, payload: { tabId: 42, platform: "netflix", timestamp: "01:30" } })).ok, true);
    assert.equal(injections[0].world, "MAIN");
    assert.deepEqual(injections[0].target, { tabId: 42, frameIds: [0] });
    assert.deepEqual(injections[0].files, ["platforms/netflix/page.js"]);
    assert.equal(injections[1].world, "MAIN");
    assert.deepEqual(injections[1].args, [90, url]);
    await route({ type: Command.DebugSeek, payload: { tabId: 42, platform: "netflix", timestamp: "invalid" } });
    assert.equal(injections.length, 2);

    const mismatch = await route({ type: Command.DebugSeek, payload: { tabId: 42, platform: "youtube", timestamp: "90" } });
    assert.ok(!mismatch.ok);
    assert.equal(injections.length, 2);

    result = { ok: false, error: { code: "SEEK_FAILED", message: "Player unavailable" } };
    const failedSeek = await route({ type: Command.DebugSeek, payload: { tabId: 42, platform: "netflix", timestamp: "90" } });
    assert.deepEqual(failedSeek, result);

    const srt = "1\n00:01:30,000 --> 00:02:00,000\nSong";
    result = { ok: true, data: { file: { filename: "cut.srt", ranges: [{ startSeconds: 90, endSeconds: 120, reason: "Song" }] }, enabled: true, error: null } };
    const loaded = await route({ type: Command.FileLoad, payload: { tabId: 42, platform: "netflix", filename: "cut.srt", text: srt } });
    assert.deepEqual(loaded, result);
    assert.deepEqual(injections[4].files, ["platforms/netflix/page.js"]);
    assert.deepEqual(injections[5].args, ["cut.srt", srt, url]);
    assert.deepEqual(injections[5].target, { tabId: 42, frameIds: [0] });
    assert.equal(injections[5].world, "MAIN");
    assert.equal(injections.length, 6);
    assert.deepEqual(await route({ type: Command.FileGet, payload: { tabId: 42, platform: "netflix" } }), result);
    assert.deepEqual(injections[7].args, []);
    result = { ok: true, data: { file: { filename: "cut.srt", ranges: [{ startSeconds: 90, endSeconds: 120, reason: "Song" }] }, enabled: false, error: null } };
    assert.deepEqual(await route({ type: Command.FileSetEnabled, payload: { tabId: 42, platform: "netflix", enabled: false } }), result);
    assert.deepEqual(injections[9].args, [false]);
    assert.deepEqual(injections[9].target, { tabId: 42, frameIds: [0] });
    result = { ok: false, error: { code: "REQUEST_FAILED", message: "Load an SRT first" } };
    assert.deepEqual(await route({ type: Command.FileSetEnabled, payload: { tabId: 42, platform: "netflix", enabled: true } }), result);
  } finally {
    if (previous) Object.defineProperty(globalThis, "chrome", previous);
    else Reflect.deleteProperty(globalThis, "chrome");
  }
});

test("deferred player features fail at the worker boundary before any code is injected", async context => {
  const previous = Object.getOwnPropertyDescriptor(globalThis, "chrome");
  let url = youtubeUrl;
  let injections = 0;
  Object.defineProperty(globalThis, "chrome", { configurable: true, value: {
    tabs: { get: async () => ({ url }) },
    scripting: { executeScript: async () => { injections += 1; throw new Error("Deferred players must not be injected."); } }
  } });
  context.after(() => {
    if (previous) Object.defineProperty(globalThis, "chrome", previous);
    else Reflect.deleteProperty(globalThis, "chrome");
  });
  for (const platform of ["prime", "youtube"] as const) {
    url = platform === "prime" ? "https://www.primevideo.com/detail/fixture" : youtubeUrl;
    const payload = { tabId: 42, platform };
    const requests: Request[] = [
      { type: Command.DebugSeek, payload: { ...payload, timestamp: "90" } },
      { type: Command.DebugGet, payload },
      { type: Command.FileGet, payload },
      { type: Command.FileSetEnabled, payload: { ...payload, enabled: false } },
      { type: Command.DebugConfigure, payload: { ...payload, options: { showTimestamp: true, showSkipRanges: false } } },
      { type: Command.FileLoad, payload: { ...payload, filename: "cut.srt", text: "1\n00:00:00,000 --> 00:00:10,000\nScene" } }
    ];
    for (const request of requests) {
      const reply = await route(request);
      assert.ok(!reply.ok);
      assert.equal(reply.error.code, "NOT_IMPLEMENTED");
    }
  }
  assert.equal(injections, 0);
});

test("the popup catalog exposes data contracts and enables only Netflix for validation", () => {
  const ids: Platform[] = ["netflix", "prime", "youtube"];
  for (const id of ids) {
    const info = getPlatformInfo(id);
    assert.deepEqual(JSON.parse(JSON.stringify(info)), info);
    assert.deepEqual(Object.keys(info).sort(), ["capabilities", "id", "label"]);
    assert.equal(getPlatform(id).capabilities, info.capabilities);
    assert.deepEqual(info.capabilities, { debugSeek: id === "netflix", skipFiles: id === "netflix", playerOverlays: id === "netflix" });
  }
});

test("planned calls return NOT_IMPLEMENTED instead of fake success", async () => {
  const result = await route({ type: Command.SessionGet, payload: { tabId: 42, platform: "youtube" } });
  assert.equal(result.ok, false);
  if (!result.ok) assert.equal(result.error.code, "NOT_IMPLEMENTED");
});

test("Netflix overlay commands preserve tab, settings and failures through the worker", async context => {
  const previous = Object.getOwnPropertyDescriptor(globalThis, "chrome");
  const injections: chrome.scripting.ScriptInjection<unknown[], unknown>[] = [];
  const url = "https://www.netflix.com/watch/1234";
  const options = { showTimestamp: true, showSkipRanges: false };
  let reply: Reply<unknown> = { ok: true, data: { options, error: null } };
  Object.defineProperty(globalThis, "chrome", { configurable: true, value: {
    tabs: { get: async () => ({ url }) },
    scripting: { executeScript: async (input: chrome.scripting.ScriptInjection<unknown[], unknown>) => {
      injections.push(input);
      return [{ result: reply }];
    } }
  } });
  context.after(() => {
    if (previous) Object.defineProperty(globalThis, "chrome", previous);
    else Reflect.deleteProperty(globalThis, "chrome");
  });
  assert.deepEqual(await route({ type: Command.DebugGet, payload: { tabId: 42, platform: "netflix" } }), reply);
  assert.deepEqual(injections[0].files, ["platforms/netflix/page.js"]);
  assert.deepEqual(await route({ type: Command.DebugConfigure, payload: { tabId: 42, platform: "netflix", options } }), reply);
  assert.deepEqual(injections[3].args, [options, url]);
  assert.deepEqual(injections[3].target, { tabId: 42, frameIds: [0] });
  assert.equal(injections[3].world, "MAIN");
  reply = { ok: false, error: { code: "REQUEST_FAILED", message: "Player unavailable" } };
  assert.deepEqual(await route({ type: Command.DebugConfigure, payload: { tabId: 42, platform: "netflix", options } }), reply);
});

test("URL identification resolves registered providers without a default platform", () => {
  const cases: [Platform, string][] = [
    ["netflix", "https://www.netflix.com/watch/1234"],
    ["prime", "https://www.primevideo.com/detail/fixture"],
    ["prime", "https://www.amazon.in/gp/video/detail/fixture"],
    ["youtube", youtubeUrl]
  ];
  for (const [id, url] of cases) {
    assert.equal(identifyPlatformInfo(url), getPlatformInfo(id));
    assert.equal(identifyPlatform(url), getPlatform(id));
    assert.equal(resolvePlatform(id, url).id, id);
  }
  assert.equal(identifyPlatform("https://example.com"), undefined);
  assert.equal(identifyPlatform("https://www.youtube.com.evil.example/watch?v=fixture"), undefined);
  assert.equal(identifyPlatformInfo("http://www.netflix.com/watch/1234"), undefined);
});

test("tab-side factory creates independent platform adapters and unfinished identity calls fail explicitly", () => {
  const ids: Platform[] = ["netflix", "prime", "youtube"];
  for (const id of ids) {
    const player = createSessionAdapter(id, youtubeUrl);
    assert.equal(player.platform, id);
    assert.notEqual(player, createSessionAdapter(id, youtubeUrl));
    assert.throws(() => player.readIdentity(), /not implemented/);
  }
});
