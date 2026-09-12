import type { Reply, SeekObservation } from "../shared/contracts.ts";

export async function injectSeek<Args extends unknown[]>(
  tabId: number,
  world: `${chrome.scripting.ExecutionWorld}`,
  func: (...args: Args) => Promise<Reply<SeekObservation>>,
  args: Args
): Promise<Reply<SeekObservation>> {
  const results = await chrome.scripting.executeScript({ target: { tabId, frameIds: [0] }, world, func, args });
  if (!results[0]?.result) throw new Error("The video page closed or changed before the player replied.");
  return results[0].result;
}
