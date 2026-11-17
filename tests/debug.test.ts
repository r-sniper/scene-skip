import test from "node:test";
import assert from "node:assert/strict";
import { setImmediate } from "node:timers/promises";
import { runInNewContext } from "node:vm";
import { buildSync } from "esbuild";
import { Command } from "../src/shared/commands.ts";
import type { Calls, CommandName, Request } from "../src/shared/messages.ts";
import { getPlatformInfo, identifyPlatformInfo } from "../src/platforms/catalog.ts";
import type { Reply, SeekObservation } from "../src/shared/contracts.ts";

const bundle = buildSync({ entryPoints: ["src/popup/client.ts"], bundle: true, format: "iife", globalName: "popupClient", write: false });
assert.ok(bundle.outputFiles);
const clientSource = bundle.outputFiles[0].text;
const netflixUrl = "https://www.netflix.com/watch/1234";
const observation: SeekObservation = { requestedSeconds: 90, observedSeconds: 90.1 };

interface Client {
  call<K extends CommandName>(type: K, payload: Calls[K]["input"]): Promise<Calls[K]["output"]>;
}

function isClient(value: unknown): value is Client {
  return typeof value === "object" && value !== null && "call" in value && typeof value.call === "function";
}

interface Injection {
  target: { tabId: number; frameIds?: number[]; documentIds?: string[] };
  world: string;
  files: string[];
  args?: unknown[];
}

function fixture() {
  const injections: Injection[] = [];
  const messages: { tabId: number; request: Request; options: { documentId: string } }[] = [];
  let url: string | undefined = netflixUrl;
  let beforeInjection = async (_injection: Injection) => {};
  let response = async (_request: Request): Promise<unknown> => ({ ok: true, data: observation });
  const client: unknown = runInNewContext(`${clientSource}; popupClient;`, {
    URL,
    chrome: {
      tabs: {
        get: async () => ({ url }),
        sendMessage: async (tabId: number, request: Request, options: { documentId: string }) => {
          messages.push({ tabId, request, options });
          return response(request);
        }
      },
      scripting: {
        executeScript: async (injection: Injection) => {
          injections.push(injection);
          await beforeInjection(injection);
          return [{ frameId: 0, documentId: "document-42" }];
        }
      },
      runtime: { sendMessage: () => assert.fail("Popup commands must go directly to the tab.") }
    }
  });
  assert.ok(isClient(client));
  return {
    client, injections, messages,
    setUrl(value: string | undefined) { url = value; },
    beforeInjection(callback: (injection: Injection) => Promise<void>) { beforeInjection = callback; },
    respond(callback: (request: Request) => Promise<unknown>) { response = callback; }
  };
}

test("popup installs MAIN then ISOLATED code and sends commands to the same document", async () => {
  const context = fixture();
  const payload = { tabId: 42, platform: "netflix", timestamp: "01:30" } as const;
  assert.deepEqual(structuredClone(await context.client.call(Command.DebugSeek, payload)), observation);
  assert.deepEqual(structuredClone(context.injections), [
    { target: { tabId: 42, frameIds: [0] }, world: "MAIN", files: ["platforms/netflix/page.js"] },
    { target: { tabId: 42, documentIds: ["document-42"] }, world: "ISOLATED", files: ["content/index.js"] }
  ]);
  assert.deepEqual(structuredClone(context.messages), [{ tabId: 42, request: { type: Command.DebugSeek, payload }, options: { documentId: "document-42" } }]);
});

test("simultaneous popup requests share initialization and later query changes preserve the session", async () => {
  const context = fixture();
  const installed = Promise.withResolvers<void>();
  context.beforeInjection(async injection => {
    if (injection.world === "MAIN") await installed.promise;
  });
  const payload = { tabId: 42, platform: "netflix", timestamp: "90" } as const;
  const first = context.client.call(Command.DebugSeek, payload);
  const second = context.client.call(Command.DebugSeek, payload);
  await setImmediate();
  assert.equal(context.injections.length, 1);
  assert.equal(context.messages.length, 0);
  installed.resolve();
  await Promise.all([first, second]);
  assert.equal(context.injections.length, 2);
  context.setUrl(netflixUrl + "?tracking=new");
  await context.client.call(Command.DebugSeek, payload);
  assert.equal(context.injections.length, 2);
  assert.equal(context.messages.length, 3);
});

test("file text is sent only to ISOLATED content commands, not MAIN bootstrap", async () => {
  const context = fixture();
  const file = { filename: "private.srt", ranges: [{ startSeconds: 90, endSeconds: 120, reason: "Private reason" }] };
  const state = { file, enabled: true, error: null };
  context.respond(async () => ({ ok: true, data: state }));
  const payload = { tabId: 42, platform: "netflix", filename: file.filename, text: "1\n00:01:30,000 --> 00:02:00,000\nPrivate reason" } as const;
  assert.deepEqual(structuredClone(await context.client.call(Command.FileLoad, payload)), state);
  assert.equal(context.injections.some(injection => injection.args !== undefined), false);
  assert.equal(context.messages[0].request.type, Command.FileLoad);
  assert.deepEqual(context.messages[0].request.payload, payload);
});

test("platform mismatch, missing access and deferred platforms fail before injection", async () => {
  const context = fixture();
  const payload = { tabId: 42, platform: "netflix", timestamp: "90" } as const;
  context.setUrl(undefined);
  await assert.rejects(context.client.call(Command.DebugSeek, payload), /grant access/);
  context.setUrl("https://www.youtube.com/watch?v=fixture");
  await assert.rejects(context.client.call(Command.DebugSeek, payload), /Open a Netflix video/);
  await assert.rejects(context.client.call(Command.DebugSeek, { ...payload, platform: "youtube" }), /not implemented/);
  context.setUrl("https://www.netflix.com/browse");
  await assert.rejects(context.client.call(Command.DebugSeek, payload), /movie or episode player/);
  assert.equal(context.injections.length, 0);
  assert.equal(context.messages.length, 0);
});

test("bootstrap failure stays a failure and never sends or retries a command", async () => {
  const context = fixture();
  context.beforeInjection(async () => { throw new Error("Document changed during setup"); });
  const payload = { tabId: 42, platform: "netflix", timestamp: "90" } as const;
  await assert.rejects(context.client.call(Command.DebugSeek, payload), /Document changed during setup/);
  await assert.rejects(context.client.call(Command.DebugSeek, payload), /Document changed during setup/);
  assert.equal(context.injections.length, 1);
  assert.equal(context.messages.length, 0);
});

test("closed document, malformed replies and operation failures reject without reporting success", async () => {
  const context = fixture();
  const payload = { tabId: 42, platform: "netflix", timestamp: "90" } as const;
  context.respond(async () => { throw new Error("The document was removed"); });
  await assert.rejects(context.client.call(Command.DebugSeek, payload), /document was removed/);
  context.respond(async () => ({ ok: true, data: { requestedSeconds: 90, observedSeconds: "fabricated" } }));
  await assert.rejects(context.client.call(Command.DebugSeek, payload));
  const failure: Reply<SeekObservation> = { ok: false, error: { code: "SEEK_FAILED", message: "Netflix did not finish seeking" } };
  context.respond(async () => failure);
  await assert.rejects(context.client.call(Command.DebugSeek, payload), /did not finish seeking/);
  assert.equal(context.injections.length, 2);
});

test("only Netflix capabilities are enabled and host matching is exact", () => {
  for (const id of ["netflix", "prime", "youtube"] as const) {
    const info = getPlatformInfo(id);
    assert.deepEqual(info.capabilities, { debugSeek: id === "netflix", skipFiles: id === "netflix", playerOverlays: id === "netflix" });
  }
  assert.equal(identifyPlatformInfo(netflixUrl)?.id, "netflix");
  assert.equal(identifyPlatformInfo("https://www.netflix.com.evil.example/watch/1234"), undefined);
  assert.equal(identifyPlatformInfo("http://www.netflix.com/watch/1234"), undefined);
});
