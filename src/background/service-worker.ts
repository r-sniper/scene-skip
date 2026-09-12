import { route } from "./router.ts";
import type { Request } from "../shared/messages.ts";

chrome.runtime.onMessage.addListener((request: Request, sender, sendResponse) => {
  if (sender.id !== chrome.runtime.id || sender.url !== chrome.runtime.getURL("popup/index.html")) return;
  void route(request).then(sendResponse);
  // Keep async replies compatible with Chrome versions without Promise-based message listeners.
  return true;
});
