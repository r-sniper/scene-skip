import type { Reply } from "../../shared/contracts.ts";

export async function injectNetflix<Args extends unknown[], Result>(
  tabId: number,
  func: (...args: Args) => Promise<Reply<Result>>,
  args: Args
): Promise<Reply<Result>> {
  const target = { tabId, frameIds: [0] };
  await chrome.scripting.executeScript({ target, world: "MAIN", files: ["platforms/netflix/page.js"] });
  const results = await chrome.scripting.executeScript({ target, world: "MAIN", func, args });
  if (!results[0]?.result) throw new Error("The Netflix page closed or changed before it replied.");
  return results[0].result;
}
