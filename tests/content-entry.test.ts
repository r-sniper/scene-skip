import test from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { setImmediate } from "node:timers/promises";
import { createContext, runInContext } from "node:vm";
import { build } from "esbuild";
import { Command } from "../src/shared/commands.ts";
import { parseReply } from "../src/shared/messages.ts";
import type { Calls, CommandName } from "../src/shared/messages.ts";

interface PageMessage {
  data: unknown;
  origin: string;
  source: FixtureWindow;
}

class FixtureWindow {
  readonly listeners = new Set<(event: PageMessage) => void>();
  readonly incoming: unknown[] = [];

  constructor(private readonly windows: FixtureWindow[], private readonly origin: string) {
    windows.push(this);
  }

  addEventListener(type: string, listener: (event: PageMessage) => void): void {
    assert.equal(type, "message");
    this.listeners.add(listener);
  }

  removeEventListener(type: string, listener: (event: PageMessage) => void): void {
    assert.equal(type, "message");
    this.listeners.delete(listener);
  }

  postMessage(data: unknown, origin: string): void {
    assert.equal(origin, this.origin);
    for (const receiver of this.windows) {
      const message: PageMessage = { data: structuredClone(data), origin, source: receiver };
      receiver.incoming.push(message.data);
      queueMicrotask(() => {
        for (const listener of receiver.listeners) listener(message);
      });
    }
  }
}

class FixtureLayer {
  dataset: Record<string, string> = {};
  className = "";
  textContent = "";
  children: FixtureLayer[] = [];
  removed = false;
  attachShadow(): FixtureLayer { return new FixtureLayer(); }
  append(...children: FixtureLayer[]): void { this.children.push(...children); }
  remove(): void { this.removed = true; }
}

type RuntimeListener = (request: unknown, sender: { id: string; url: string }, reply: (value: unknown) => void) => boolean | undefined;

async function fixture() {
  const bundled = await build({
    entryPoints: { main: "src/platforms/netflix/page.ts", content: "src/content/index.ts" },
    bundle: true, format: "iife", write: false, outdir: ".artifacts/content-entry"
  });
  const mainCode = bundled.outputFiles.find(file => file.path.endsWith("main.js"));
  const contentCode = bundled.outputFiles.find(file => file.path.endsWith("content.js"));
  assert.ok(mainCode);
  assert.ok(contentCode);
  const windows: FixtureWindow[] = [];
  const origin = "https://www.netflix.com";
  const mainWindow = new FixtureWindow(windows, origin);
  const contentWindow = new FixtureWindow(windows, origin);
  const location = { href: `${origin}/watch/1234`, origin };
  const video = Object.assign(new EventTarget(), { readyState: 4, duration: 600, paused: true, ended: false, seeking: false });
  const seeks: number[] = [];
  let positionMs = 8000;
  let available = true;
  const api = {
    getCurrentTime: () => positionMs,
    seek(milliseconds: number) {
      seeks.push(milliseconds);
      positionMs = milliseconds;
      video.dispatchEvent(new Event("seeked"));
    }
  };
  Object.assign(mainWindow, { netflix: { appContext: { state: { playerApp: { getAPI: () => ({ videoPlayer: {
    getAllPlayerSessionIds: () => ["session"], getVideoPlayerBySessionId: () => api
  } }) } } } } });
  const timers = new Map<number, { callback: () => void; delay: number }>();
  let timerId = 0;
  let createdElements = 0;
  const globals = {
    location, URL, crypto: { randomUUID }, console,
    document: {
      querySelector: (selector: string) => selector === "video" && available ? video : null,
      createElement: () => { createdElements += 1; return new FixtureLayer(); }
    },
    setTimeout: (callback: () => void, delay: number) => {
      const id = ++timerId;
      timers.set(id, { callback, delay });
      return id;
    },
    clearTimeout: (id: number) => timers.delete(id)
  };
  const runtimeListeners: RuntimeListener[] = [];
  const sender = { id: "fixture-extension", url: "chrome-extension://fixture-extension/popup/index.html" };
  const main = createContext({ ...globals, window: mainWindow });
  const content = createContext({ ...globals, window: contentWindow, chrome: { runtime: {
    id: sender.id, getURL: (path: string) => `chrome-extension://${sender.id}/${path}`,
    onMessage: { addListener: (listener: RuntimeListener) => runtimeListeners.push(listener) }
  } } });
  function inject(): void {
    runInContext(mainCode.text, main);
    runInContext(contentCode.text, content);
  }
  async function command<K extends CommandName>(type: K, payload: Calls[K]["input"]): Promise<Calls[K]["output"]> {
    assert.equal(runtimeListeners.length, 1);
    const value = await new Promise<unknown>(resolve => {
      assert.equal(runtimeListeners[0]({ type, payload }, sender, reply => resolve(structuredClone(reply))), true);
    });
    const reply = parseReply(type, value);
    if (!reply.ok) throw new Error(reply.error.message);
    return reply.data;
  }
  async function tick(): Promise<void> {
    const tickTimers = [...timers.entries()].filter(([, timer]) => timer.delay === 250);
    assert.equal(tickTimers.length, 1);
    for (const [id, timer] of tickTimers) { timers.delete(id); timer.callback(); }
    await setImmediate();
  }
  return {
    inject, command, tick, main, content, mainWindow, contentWindow, runtimeListeners, sender, timers, video, seeks, location,
    elements: () => createdElements,
    position: (seconds: number) => { positionMs = seconds * 1000; },
    makeUnavailable: () => { available = false; }
  };
}

test("bundled MAIN and ISOLATED entries share player commands while retaining private tab state", async () => {
  const current = await fixture();
  const target = { tabId: 42, platform: "netflix" as const };
  current.inject();
  const elementCount = current.elements();
  current.inject();
  assert.equal(current.runtimeListeners.length, 1);
  assert.equal(current.mainWindow.listeners.size, 1);
  assert.equal(current.elements(), elementCount);
  assert.equal(runInContext("typeof window.netflix", current.content), "undefined");
  assert.equal(runInContext("typeof chrome", current.main), "undefined");
  let replied = false;
  assert.equal(current.runtimeListeners[0]({ type: Command.FileGet, payload: target }, { ...current.sender, url: "https://www.netflix.com" }, () => { replied = true; }), undefined);
  assert.equal(replied, false);
  assert.equal((await current.command(Command.SessionGet, target)).currentSeconds, 8);
  assert.deepEqual(await current.command(Command.DebugSeek, { ...target, timestamp: "01:30.500" }), { requestedSeconds: 90.5, observedSeconds: 90.5 });

  const text = "1\n00:01:30,000 --> 00:02:00,000\nPRIVATE_REASON_STRING";
  for (const filename of ["", "   "]) {
    await assert.rejects(current.command(Command.FileLoad, { ...target, filename, text }), /filename/);
    assert.deepEqual(await current.command(Command.FileGet, target), { file: null, enabled: false, error: null });
    assert.equal([...current.timers.values()].filter(timer => timer.delay === 250).length, 0);
  }
  const loaded = await current.command(Command.FileLoad, { ...target, filename: "PRIVATE_FILE.srt", text });
  assert.equal(loaded.file.filename, "PRIVATE_FILE.srt");
  await setImmediate();
  current.video.paused = false;
  current.position(95);
  await current.tick();
  assert.deepEqual(current.seeks, [90_500, 120_000]);
  assert.equal((await current.command(Command.FileSetEnabled, { ...target, enabled: false })).enabled, false);
  current.position(95);
  await current.tick();
  assert.deepEqual(current.seeks, [90_500, 120_000]);

  current.inject();
  assert.equal(current.runtimeListeners.length, 1);
  assert.equal(current.mainWindow.listeners.size, 1);
  assert.equal(current.elements(), elementCount);
  const restored = await current.command(Command.FileGet, target);
  assert.equal(restored.file?.filename, "PRIVATE_FILE.srt");
  assert.equal(restored.enabled, false);
  const mainMessages = JSON.stringify(current.mainWindow.incoming);
  assert.doesNotMatch(mainMessages, /PRIVATE_FILE|PRIVATE_REASON|loadFile/);
  assert.equal(runInContext("typeof window.__sceneSkipNetflix", current.main), "undefined");

  current.location.href = "https://www.netflix.com/watch/5678";
  current.makeUnavailable();
  const messageCount = current.mainWindow.incoming.length;
  assert.deepEqual(await current.command(Command.FileGet, target), { file: null, enabled: false, error: null });
  assert.equal(current.mainWindow.incoming.length, messageCount);
  await current.tick();
  assert.equal([...current.timers.values()].filter(timer => timer.delay === 250).length, 0);
  await assert.rejects(current.command(Command.FileLoad, { ...target, filename: "new.srt", text }), /Wait for the Netflix video to load/);
});
