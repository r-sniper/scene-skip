import test, { beforeEach } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { setImmediate } from "node:timers/promises";
import { runInNewContext } from "node:vm";
import { buildSync } from "esbuild";
import { Command } from "../src/shared/commands.ts";
import type { LoadedSkipState, Reply, SkipState } from "../src/shared/contracts.ts";
import type { Request } from "../src/shared/messages.ts";

const bundle = buildSync({ entryPoints: ["src/popup/index.ts"], bundle: true, format: "iife", write: false });
assert.ok(bundle.outputFiles);
const popupSource = bundle.outputFiles[0].text;
const html = readFileSync("public/popup/index.html", "utf8");
const loaded: LoadedSkipState = {
  file: { filename: "My <cut>.srt", ranges: [{ startSeconds: 90, endSeconds: 120, reason: "Scene" }] },
  enabled: true,
  error: null
};

beforeEach(context => {
  context.mock.timers.enable({ apis: ["setTimeout"] });
});

class FixtureElement {
  textContent = "";
  value = "";
  title = "";
  hidden = false;
  disabled = false;
  checked = false;
  dataset: Record<string, string> = {};
  attributes = new Map<string, string>();
  files: { item(index: number): { name: string; text(): Promise<string> } | null } | null = null;
  listeners = new Map<string, ((event: { preventDefault(): void }) => unknown)[]>();
  addEventListener(type: string, listener: (event: { preventDefault(): void }) => unknown) {
    const listeners = this.listeners.get(type) ?? [];
    listeners.push(listener);
    this.listeners.set(type, listeners);
  }
  setAttribute(name: string, value: string) { this.attributes.set(name, value); }
  setCustomValidity(message: string) { this.attributes.set("validity", message); }
  async emit(type: string) {
    const listeners = this.listeners.get(type);
    assert.ok(listeners, "Expected handler for " + type);
    for (const listener of listeners) await listener({ preventDefault() {} });
  }
}

async function openPopup(sendMessage: (request: Request) => Promise<Reply<unknown>>) {
  const nodes = new Map<string, FixtureElement>();
  for (const match of html.matchAll(/<[a-z][\w-]*\b([^>]*\bid="([^"]+)"[^>]*)>/g)) {
    const node = new FixtureElement();
    node.hidden = /\bhidden\b/.test(match[1]);
    node.disabled = /\bdisabled\b/.test(match[1]);
    nodes.set(match[2], node);
  }
  runInNewContext(popupSource, {
    URL,
    setTimeout,
    document: { getElementById: (id: string) => nodes.get(id) },
    HTMLElement: FixtureElement,
    HTMLSelectElement: FixtureElement,
    HTMLFieldSetElement: FixtureElement,
    HTMLFormElement: FixtureElement,
    HTMLInputElement: FixtureElement,
    HTMLParagraphElement: FixtureElement,
    HTMLButtonElement: FixtureElement,
    HTMLSpanElement: FixtureElement,
    HTMLDivElement: FixtureElement,
    chrome: {
      tabs: { query: async () => [{ id: 42, url: "https://www.netflix.com/watch/1234", title: "Netflix fixture" }] },
      runtime: { sendMessage }
    }
  });
  await setImmediate();
  return {
    get(id: string) {
      const node = nodes.get(id);
      assert.ok(node, "Missing fixture node: " + id);
      return node;
    }
  };
}

function transport(initial: SkipState) {
  let state = initial;
  let failDebug = false;
  let failToggle = false;
  let failLoad = false;
  const requests: Request[] = [];
  async function sendMessage(request: Request): Promise<Reply<unknown>> {
    requests.push(request);
    switch (request.type) {
      case Command.FileGet: return { ok: true, data: state };
      case Command.DebugGet: return failDebug
        ? { ok: false, error: { code: "REQUEST_FAILED", message: "Debug unavailable" } }
        : { ok: true, data: { options: { showTimestamp: false, showSkipRanges: false }, error: null } };
      case Command.FileLoad:
        if (failLoad) return { ok: false, error: { code: "REQUEST_FAILED", message: "Invalid SRT" } };
        state = loaded;
        return { ok: true, data: state };
      case Command.FileSetEnabled:
        if (failToggle) return { ok: false, error: { code: "REQUEST_FAILED", message: "Video changed" } };
        assert.ok(state.file);
        state = { file: state.file, enabled: request.payload.enabled, error: state.error };
        return { ok: true, data: state };
      default: throw new Error("Unexpected popup request: " + request.type);
    }
  }
  return { sendMessage, requests, failDebug: () => { failDebug = true; }, failToggle: () => { failToggle = true; }, failLoad: () => { failLoad = true; } };
}

test("the popup replaces upload controls with the loaded filename, count and skip button", async () => {
  const backend = transport({ file: null, enabled: false, error: null });
  const popup = await openPopup(backend.sendMessage);
  assert.equal(popup.get("skip-file").disabled, false);
  assert.equal(popup.get("file-summary").hidden, true);
  popup.get("skip-file").files = { item: () => ({ name: loaded.file.filename, text: async () => "SRT fixture" }) };
  await popup.get("skip-file").emit("change");
  assert.equal(popup.get("file-summary").hidden, false);
  assert.equal(popup.get("file-upload").hidden, true);
  assert.equal(popup.get("loaded-file").textContent, loaded.file.filename);
  assert.equal(popup.get("file-details").textContent, "1 skip segment loaded");
  assert.equal(popup.get("skip-state").textContent, "Skipping on");
  assert.equal(popup.get("skip-toggle").textContent, "Disable skipping");
  assert.equal(popup.get("skip-toggle").disabled, false);
  assert.equal(popup.get("show-segments").disabled, false);
  assert.equal(popup.get("skip-file").value, "");
});

test("the popup restores disabled skipping and its filename without relying on debug state", async () => {
  const backend = transport(loaded);
  backend.failDebug();
  const popup = await openPopup(backend.sendMessage);
  assert.equal(popup.get("loaded-file").textContent, loaded.file.filename);
  assert.equal(popup.get("skip-toggle").disabled, false);
  await popup.get("skip-toggle").emit("click");
  assert.equal(popup.get("skip-state").textContent, "Skipping off");
  assert.equal(popup.get("skip-toggle").textContent, "Enable skipping");
  const reopened = await openPopup(backend.sendMessage);
  assert.equal(reopened.get("file-summary").hidden, false);
  assert.equal(reopened.get("loaded-file").textContent, loaded.file.filename);
  assert.equal(reopened.get("skip-state").textContent, "Skipping off");
  await reopened.get("skip-toggle").emit("click");
  assert.equal(reopened.get("skip-state").textContent, "Skipping on");
  assert.deepEqual(backend.requests.filter(request => request.type === Command.FileSetEnabled).map(request => request.payload.enabled), [false, true]);
});

test("failed loads and toggles display errors without claiming success or losing a loaded file", async () => {
  const backend = transport({ file: null, enabled: false, error: null });
  backend.failLoad();
  const popup = await openPopup(backend.sendMessage);
  popup.get("skip-file").files = { item: () => ({ name: "bad.srt", text: async () => "bad" }) };
  await popup.get("skip-file").emit("change");
  assert.equal(popup.get("file-summary").hidden, true);
  assert.equal(popup.get("file-status").textContent, "Invalid SRT");
  assert.equal(popup.get("file-status").hidden, false);
  assert.equal(popup.get("skip-file").disabled, false);
  const loadedBackend = transport(loaded);
  loadedBackend.failToggle();
  const loadedPopup = await openPopup(loadedBackend.sendMessage);
  await loadedPopup.get("skip-toggle").emit("click");
  assert.equal(loadedPopup.get("file-summary").hidden, false);
  assert.equal(loadedPopup.get("loaded-file").textContent, loaded.file.filename);
  assert.equal(loadedPopup.get("skip-state").textContent, "Skipping on");
  assert.equal(loadedPopup.get("skip-toggle").textContent, "Disable skipping");
  assert.equal(loadedPopup.get("file-status").textContent, "Video changed");
});

test("a recorded playback error remains visible alongside the loaded file", async () => {
  const popup = await openPopup(transport({ ...loaded, enabled: false, error: "Seek failed" }).sendMessage);
  assert.equal(popup.get("file-summary").hidden, false);
  assert.equal(popup.get("skip-state").textContent, "Skipping stopped");
  assert.equal(popup.get("file-status").textContent, "Seek failed");
  assert.equal(popup.get("skip-toggle").disabled, true);
});

test("an open popup shows a playback failure after loading without reopening", async context => {
  const backend = transport({ file: null, enabled: false, error: null });
  let failure: string | null = null;
  let reads = 0;
  const popup = await openPopup(async request => {
    if (request.type === Command.FileGet) {
      reads += 1;
      if (failure) return { ok: true, data: { ...loaded, error: failure } };
    }
    return backend.sendMessage(request);
  });
  context.mock.timers.tick(1000);
  await setImmediate();
  assert.equal(reads, 1);
  popup.get("skip-file").files = { item: () => ({ name: loaded.file.filename, text: async () => "SRT fixture" }) };
  await popup.get("skip-file").emit("change");
  assert.equal(popup.get("skip-state").textContent, "Skipping on");
  failure = "Seek API failed";
  context.mock.timers.tick(999);
  await setImmediate();
  assert.equal(reads, 1);
  context.mock.timers.tick(1);
  await setImmediate();
  assert.equal(reads, 2);
  assert.equal(popup.get("loaded-file").textContent, loaded.file.filename);
  assert.equal(popup.get("skip-state").textContent, "Skipping stopped");
  assert.equal(popup.get("file-status").textContent, failure);
  context.mock.timers.tick(1000);
  await setImmediate();
  assert.equal(reads, 2);
});

test("status reads wait for completion and cannot overwrite a newer toggle result", async context => {
  const backend = transport(loaded);
  const pending = Promise.withResolvers<Reply<SkipState>>();
  let reads = 0;
  const popup = await openPopup(request => {
    if (request.type === Command.FileGet && ++reads === 2) return pending.promise;
    return backend.sendMessage(request);
  });
  context.mock.timers.tick(1000);
  await setImmediate();
  assert.equal(reads, 2);
  context.mock.timers.tick(3000);
  await setImmediate();
  assert.equal(reads, 2);
  await popup.get("skip-toggle").emit("click");
  assert.equal(popup.get("skip-state").textContent, "Skipping off");
  pending.resolve({ ok: true, data: loaded });
  await setImmediate();
  assert.equal(popup.get("skip-state").textContent, "Skipping off");
  context.mock.timers.tick(999);
  await setImmediate();
  assert.equal(reads, 2);
  context.mock.timers.tick(1);
  await setImmediate();
  assert.equal(reads, 3);
});

test("refresh pauses during popup actions and preserves an unchanged action error", async context => {
  const backend = transport(loaded);
  const pending = Promise.withResolvers<Reply<LoadedSkipState>>();
  let reads = 0;
  const popup = await openPopup(request => {
    if (request.type === Command.FileGet) reads += 1;
    if (request.type === Command.FileSetEnabled) return pending.promise;
    return backend.sendMessage(request);
  });
  const toggle = popup.get("skip-toggle").emit("click");
  context.mock.timers.tick(1000);
  await setImmediate();
  assert.equal(reads, 1);
  assert.equal(popup.get("file-status").textContent, "Disabling skipping…");
  pending.resolve({ ok: false, error: { code: "REQUEST_FAILED", message: "Toggle failed" } });
  await toggle;
  context.mock.timers.tick(1000);
  await setImmediate();
  assert.equal(reads, 2);
  assert.equal(popup.get("file-status").textContent, "Toggle failed");
});

test("a failed status read keeps the filename, marks status unavailable and stops refreshing", async context => {
  const backend = transport(loaded);
  let reads = 0;
  const popup = await openPopup(async request => {
    if (request.type === Command.FileGet && ++reads > 1) {
      return { ok: false, error: { code: "REQUEST_FAILED", message: "Video tab closed" } };
    }
    return backend.sendMessage(request);
  });
  context.mock.timers.tick(1000);
  await setImmediate();
  assert.equal(popup.get("loaded-file").textContent, loaded.file.filename);
  assert.equal(popup.get("skip-state").textContent, "Status unavailable");
  assert.match(popup.get("file-status").textContent, /Video tab closed.*Reopen/);
  context.mock.timers.tick(3000);
  await setImmediate();
  assert.equal(reads, 2);
});

test("switching platforms discards a pending file status reply", async context => {
  const backend = transport(loaded);
  const pending = Promise.withResolvers<Reply<SkipState>>();
  let reads = 0;
  const popup = await openPopup(request => {
    if (request.type === Command.FileGet && ++reads === 2) return pending.promise;
    return backend.sendMessage(request);
  });
  context.mock.timers.tick(1000);
  await setImmediate();
  popup.get("platform").value = "youtube";
  await popup.get("platform").emit("change");
  pending.resolve({ ok: true, data: { ...loaded, error: "Old player failed" } });
  await setImmediate();
  assert.equal(popup.get("file-summary").hidden, true);
  assert.equal(popup.get("file-status").hidden, true);
  context.mock.timers.tick(1000);
  await setImmediate();
  assert.equal(reads, 2);
});
