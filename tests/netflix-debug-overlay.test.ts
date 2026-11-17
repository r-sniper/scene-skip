import test from "node:test";
import type { TestContext } from "node:test";
import assert from "node:assert/strict";
import { NetflixDebugOverlay } from "../src/platforms/netflix/debug-overlay.ts";
import type { PlaybackSnapshot, SkipRange } from "../src/shared/contracts.ts";

class FixtureElement {
  children: FixtureElement[] = [];
  parentElement: FixtureElement | null = null;
  shadowRoot: FixtureElement | null = null;
  dataset: Record<string, string> = {};
  style = { position: "", left: "", top: "", width: "" };
  attributes = new Map<string, string>();
  selectors = new Map<string, FixtureElement>();
  className = "";
  textContent = "";
  bounds = { left: 100, top: 50 };
  attachShadow() { this.shadowRoot = new FixtureElement(); return this.shadowRoot; }
  append(...children: FixtureElement[]) {
    for (const child of children) {
      child.remove();
      child.parentElement = this;
      this.children.push(child);
    }
  }
  remove() {
    if (this.parentElement) this.parentElement.children = this.parentElement.children.filter(child => child !== this);
    this.parentElement = null;
  }
  replaceChildren(...children: FixtureElement[]) {
    for (const child of [...this.children]) child.remove();
    this.append(...children);
  }
  querySelector(selector: string) { return this.selectors.get(selector) ?? null; }
  getBoundingClientRect() { return this.bounds; }
  setAttribute(name: string, value: string) { this.attributes.set(name, value); }
  removeAttribute(name: string) { this.attributes.delete(name); }
}

const playback: PlaybackSnapshot = { currentSeconds: 12.5, durationSeconds: 200, paused: true, ended: false };
const ranges: SkipRange[] = [
  { startSeconds: 60, endSeconds: 100, reason: "<b>Plain text</b>" },
  { startSeconds: 0, endSeconds: 20, reason: "Opening" },
  { startSeconds: 90, endSeconds: 120, reason: "Overlap" }
];
const both = { showTimestamp: true, showSkipRanges: true };

function fixture(context: TestContext) {
  const player = new FixtureElement();
  const video = new FixtureElement();
  const bar = new FixtureElement();
  bar.style.position = "absolute";
  player.selectors.set("video", video);
  player.selectors.set('[data-uia="timeline-bar"]', bar);
  const page = new FixtureElement();
  page.selectors.set(".watch-video", player);
  const previous = Object.getOwnPropertyDescriptor(globalThis, "document");
  const previousComputedStyle = Object.getOwnPropertyDescriptor(globalThis, "getComputedStyle");
  Object.defineProperty(globalThis, "getComputedStyle", { configurable: true, value: (node: FixtureElement) => ({ position: node.style.position || "static" }) });
  Object.defineProperty(globalThis, "document", { configurable: true, value: {
    querySelector: (selector: string) => page.querySelector(selector),
    createElement: () => new FixtureElement()
  } });
  context.after(() => {
    if (previous) Object.defineProperty(globalThis, "document", previous);
    else Reflect.deleteProperty(globalThis, "document");
    if (previousComputedStyle) Object.defineProperty(globalThis, "getComputedStyle", previousComputedStyle);
    else Reflect.deleteProperty(globalThis, "getComputedStyle");
  });
  return { player, video, bar, page, overlay: new NetflixDebugOverlay() };
}

function content(parent: FixtureElement, layer: string) {
  const host = parent.children.find(child => child.dataset.sceneSkip === layer);
  assert.ok(host);
  assert.ok(host.shadowRoot);
  return { host, content: host.shadowRoot.children[1], css: host.shadowRoot.children[0].textContent };
}

test("the player clock renders observed milliseconds and follows the video bounds", context => {
  const { overlay, player, video } = fixture(context);
  overlay.render(playback, { showTimestamp: true, showSkipRanges: false }, []);
  const clock = content(player, "clock");
  assert.equal(clock.content.textContent, "00:00:12.500");
  assert.equal(clock.host.style.left, "116px");
  assert.equal(clock.host.style.top, "66px");
  assert.equal(clock.content.attributes.get("role"), "timer");
  assert.match(clock.css, /pointer-events: none/);
  video.bounds = { left: 0, top: 0 };
  overlay.render({ ...playback, currentSeconds: 75.25 }, { showTimestamp: true, showSkipRanges: false }, []);
  assert.equal(clock.content.textContent, "00:01:15.250");
  assert.equal(clock.host.style.left, "16px");
  assert.equal(player.children.length, 1);
});

test("markers align with merged skip intervals as percentages and reasons remain text", context => {
  const { overlay, bar } = fixture(context);
  overlay.render(playback, both, ranges);
  const track = content(bar, "track");
  assert.deepEqual(track.content.children.map(marker => [marker.style.left, marker.style.width]), [["0%", "10%"], ["30%", "30%"]]);
  assert.match(track.content.attributes.get("aria-label")!, /<b>Plain text<\/b>/);
  assert.ok(track.content.children.every(marker => marker.children.length === 0));
  assert.match(track.css, /bottom: 100%/);
  overlay.render({ ...playback, durationSeconds: 400 }, both, ranges);
  assert.deepEqual(track.content.children.map(marker => [marker.style.left, marker.style.width]), [["0%", "5%"], ["15%", "15%"]]);
});

test("hidden or replaced native controls regain markers and disabling restores native styles", context => {
  const { overlay, player, bar } = fixture(context);
  overlay.render(playback, both, ranges);
  assert.equal(bar.style.position, "absolute");
  player.selectors.delete('[data-uia="timeline-bar"]');
  overlay.render(playback, both, ranges);
  assert.equal(bar.children.length, 0);
  assert.equal(bar.style.position, "absolute");
  const replacement = new FixtureElement();
  player.selectors.set('[data-uia="timeline-bar"]', replacement);
  overlay.render(playback, both, ranges);
  assert.equal(content(replacement, "track").content.children.length, 2);
  assert.equal(replacement.style.position, "relative");
  overlay.render(playback, { showTimestamp: false, showSkipRanges: true }, ranges);
  assert.equal(player.children.length, 0);
  overlay.clear();
  assert.equal(replacement.children.length, 0);
  assert.equal(replacement.style.position, "");
});

test("invalid ranges fail before modifying the display, and later failures remove stale markers", context => {
  const { overlay, player, bar, page } = fixture(context);
  assert.throws(() => overlay.render(playback, both, [{ startSeconds: 0, endSeconds: 201, reason: "Too long" }]), /duration/);
  assert.equal(player.children.length, 0);
  assert.equal(bar.children.length, 0);
  overlay.render(playback, both, ranges);
  const log = context.mock.method(console, "error", () => {});
  overlay.showError("Video changed");
  assert.equal(bar.children.length, 0);
  assert.equal(bar.style.position, "absolute");
  assert.match(content(player, "clock").content.textContent, /debug stopped: Video changed/);
  assert.equal(content(player, "clock").content.attributes.get("role"), "alert");
  assert.equal(log.mock.callCount(), 1);
  page.selectors.delete(".watch-video");
  assert.throws(() => overlay.render(playback, both, ranges), /overlay unavailable/);
});
