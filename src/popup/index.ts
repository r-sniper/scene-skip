import { call } from "./client.ts";
import { formatTimestamp, parseTimestamp } from "../shared/time.ts";
import type { DebugOptions, DebugState, Platform, SkipState } from "../shared/contracts.ts";
import type { Target } from "../shared/messages.ts";
import { Command } from "../shared/commands.ts";
import { getPlatformInfo, identifyPlatformInfo } from "../platforms/catalog.ts";

function element<T extends HTMLElement>(id: string, constructor: new () => T): T {
  const node = document.getElementById(id);
  if (!(node instanceof constructor)) throw new Error("Missing popup element: " + id);
  return node;
}

const platform = element("platform", HTMLSelectElement);
const debugFields = element("debug-fields", HTMLFieldSetElement);
const overlayFields = element("overlay-fields", HTMLFieldSetElement);
const form = element("seek-form", HTMLFormElement);
const timestamp = element("timestamp", HTMLInputElement);
const seekStatus = element("seek-status", HTMLParagraphElement);
const connectionStatus = element("connection-status", HTMLParagraphElement);
const observation = element("observation", HTMLParagraphElement);
const go = element("go", HTMLButtonElement);
const skipFile = element("skip-file", HTMLInputElement);
const fileStatus = element("file-status", HTMLParagraphElement);
const skipToggle = element("skip-toggle", HTMLButtonElement);
const showTimestamp = element("show-timestamp", HTMLInputElement);
const showSegments = element("show-segments", HTMLInputElement);
const overlayStatus = element("overlay-status", HTMLParagraphElement);
const timeError = element("time-error", HTMLParagraphElement);
let tabId: number | undefined;
let selectedPlatform: Platform | undefined;
let debugState: DebugState | null = null;
let skipState: SkipState | null = null;
let busy = false;

function feedback(node: HTMLElement, message: string, state: "ready" | "pending" | "error" = "ready"): void {
  node.textContent = message;
  node.dataset.state = state;
  node.hidden = message.length === 0;
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function target(): Target {
  if (tabId === undefined || selectedPlatform === undefined) throw new Error("Select a platform in a video tab first.");
  return { tabId, platform: selectedPlatform };
}

function updateControls(): void {
  const available = tabId !== undefined && selectedPlatform !== undefined && !busy;
  const capabilities = selectedPlatform === undefined ? null : getPlatformInfo(selectedPlatform).capabilities;
  const loadedFile = skipState?.file;
  debugFields.disabled = !available || !capabilities?.debugSeek;
  platform.disabled = tabId === undefined || busy;
  skipFile.disabled = !available || !capabilities?.skipFiles || skipState === null || skipState.file !== null;
  skipToggle.disabled = !available || !capabilities?.skipFiles || !loadedFile || (skipState !== null && !skipState.enabled && skipState.error !== null);
  overlayFields.disabled = !available || !capabilities?.playerOverlays || debugState === null;
  showSegments.disabled = !loadedFile;
  element("segments-help", HTMLParagraphElement).textContent = loadedFile
    ? "Green segments appear above the seek bar."
    : "Load an SRT to show segments.";
  element("overlay-help", HTMLParagraphElement).textContent = capabilities?.playerOverlays
    ? "Overlays stay on when you close this popup."
    : "Player overlays are available on Netflix.";
  element("file-help", HTMLParagraphElement).textContent = capabilities?.skipFiles
    ? "Load an SRT that matches this title and release."
    : "SRT skipping is available on Netflix.";
  element("debug-help", HTMLParagraphElement).hidden = capabilities?.debugSeek === true;
}

function renderFile(): void {
  const loadedFile = skipState?.file;
  element("file-summary", HTMLDivElement).hidden = !loadedFile;
  element("file-upload", HTMLDivElement).hidden = Boolean(loadedFile);
  element("file-help", HTMLParagraphElement).hidden = Boolean(loadedFile);
  const filename = element("loaded-file", HTMLParagraphElement);
  filename.textContent = loadedFile ? loadedFile.filename : "";
  element("file-details", HTMLParagraphElement).textContent = loadedFile
    ? loadedFile.ranges.length + " skip " + (loadedFile.ranges.length === 1 ? "segment" : "segments") + " loaded"
    : "";
  const state = element("skip-state", HTMLSpanElement);
  if (skipState !== null && loadedFile) {
    state.textContent = skipState.error ? "Skipping stopped" : skipState.enabled ? "Skipping on" : "Skipping off";
    state.dataset.state = skipState.error ? "error" : skipState.enabled ? "on" : "off";
    skipToggle.textContent = skipState.enabled ? "Disable skipping" : "Enable skipping";
  }
  feedback(fileStatus, skipState?.error ?? "", "error");
}

function renderDebug(): void {
  showTimestamp.checked = debugState !== null && debugState.options.showTimestamp;
  showSegments.checked = debugState !== null && debugState.options.showSkipRanges;
  feedback(overlayStatus, debugState?.error ?? "", "error");
}

async function selectPlatform(): Promise<void> {
  const value = platform.value;
  switch (value) {
    case "": selectedPlatform = undefined; break;
    case "netflix": case "prime": case "youtube": selectedPlatform = value; break;
    default: throw new Error("Unknown platform selection.");
  }
  busy = true;
  debugState = null;
  skipState = null;
  observation.hidden = true;
  feedback(seekStatus, "");
  feedback(connectionStatus, "");
  renderFile();
  renderDebug();
  updateControls();
  if (selectedPlatform !== undefined) {
    const capabilities = getPlatformInfo(selectedPlatform).capabilities;
    await Promise.all([
      capabilities.skipFiles ? restoreFile() : Promise.resolve(),
      capabilities.playerOverlays ? restoreDebug() : Promise.resolve()
    ]);
  }
  busy = false;
  updateControls();
}

async function restoreFile(): Promise<void> {
  feedback(fileStatus, "Reading skip file…", "pending");
  try {
    skipState = await call(Command.FileGet, target());
    renderFile();
  } catch (error) {
    feedback(fileStatus, errorMessage(error), "error");
  }
}

async function restoreDebug(): Promise<void> {
  try {
    debugState = await call(Command.DebugGet, target());
    renderDebug();
  } catch (error) {
    feedback(overlayStatus, errorMessage(error), "error");
  }
}

async function refreshFileStatus(): Promise<void> {
  while (true) {
    await new Promise<void>(resolve => setTimeout(resolve, 1000));
    const previous = skipState;
    if (busy || !previous?.file || previous.error !== null) continue;

    try {
      const current = await call(Command.FileGet, target());
      if (busy || skipState !== previous) continue;
      if (current.file === null || current.enabled !== previous.enabled || current.error !== previous.error) {
        skipState = current;
        renderFile();
        updateControls();
      }
    } catch (error) {
      if (busy || skipState !== previous) continue;
      const status = element("skip-state", HTMLSpanElement);
      status.textContent = "Status unavailable";
      status.dataset.state = "error";
      feedback(fileStatus, errorMessage(error) + " Reopen the popup to refresh status.", "error");
      return;
    }
  }
}

platform.addEventListener("change", () => { void selectPlatform(); });

timestamp.addEventListener("input", () => {
  let message = "";
  if (timestamp.value.trim()) {
    try { parseTimestamp(timestamp.value); }
    catch (error) { message = errorMessage(error); }
  }
  timestamp.setCustomValidity(message);
  timestamp.setAttribute("aria-invalid", String(message.length > 0));
  feedback(timeError, message, "error");
});

form.addEventListener("submit", async event => {
  event.preventDefault();
  busy = true;
  updateControls();
  go.textContent = "Seeking…";
  observation.hidden = true;
  feedback(seekStatus, "Requesting seek…", "pending");
  try {
    const result = await call(Command.DebugSeek, { ...target(), timestamp: timestamp.value });
    feedback(seekStatus, "Requested " + formatTimestamp(result.requestedSeconds));
    observation.textContent = "Player reports " + formatTimestamp(result.observedSeconds);
    observation.hidden = false;
  } catch (error) {
    feedback(seekStatus, errorMessage(error), "error");
  } finally {
    busy = false;
    go.textContent = "Seek";
    updateControls();
  }
});

skipFile.addEventListener("change", async () => {
  const file = skipFile.files?.item(0);
  if (!file) return;
  busy = true;
  updateControls();
  feedback(fileStatus, "Loading SRT…", "pending");
  try {
    skipState = await call(Command.FileLoad, { ...target(), filename: file.name, text: await file.text() });
    renderFile();
  } catch (error) {
    feedback(fileStatus, errorMessage(error), "error");
  } finally {
    busy = false;
    skipFile.value = "";
    updateControls();
  }
});

skipToggle.addEventListener("click", async () => {
  busy = true;
  updateControls();
  try {
    if (!skipState?.file) throw new Error("Load an SRT before enabling skipping.");
    const enabled = !skipState.enabled;
    skipToggle.textContent = enabled ? "Enabling…" : "Disabling…";
    feedback(fileStatus, enabled ? "Enabling skipping…" : "Disabling skipping…", "pending");
    skipState = await call(Command.FileSetEnabled, { ...target(), enabled });
    renderFile();
  } catch (error) {
    renderFile();
    feedback(fileStatus, errorMessage(error), "error");
  } finally {
    busy = false;
    updateControls();
  }
});

async function configureOverlays(): Promise<void> {
  const options: DebugOptions = { showTimestamp: showTimestamp.checked, showSkipRanges: showSegments.checked };
  busy = true;
  updateControls();
  feedback(overlayStatus, "Updating overlays…", "pending");
  try {
    debugState = await call(Command.DebugConfigure, { ...target(), options });
    renderDebug();
  } catch (error) {
    renderDebug();
    feedback(overlayStatus, errorMessage(error), "error");
  } finally {
    busy = false;
    updateControls();
  }
}

showTimestamp.addEventListener("change", () => { void configureOverlays(); });
showSegments.addEventListener("change", () => { void configureOverlays(); });

async function initialize(): Promise<void> {
  try {
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
    if (tab.id === undefined) throw new Error("Open Scene Skip from a video tab.");
    tabId = tab.id;
    const title = element("tab-title", HTMLParagraphElement);
    title.textContent = tab.title ?? "Open a supported video tab.";
    title.title = title.textContent;
    if (tab.url) platform.value = identifyPlatformInfo(tab.url)?.id ?? "";
    await selectPlatform();
    void refreshFileStatus();
  } catch (error) {
    feedback(connectionStatus, errorMessage(error), "error");
  }
}

void initialize();
