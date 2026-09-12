import type { Calls, CommandName } from "../shared/messages.ts";
import type { Reply } from "../shared/contracts.ts";

export async function call<K extends CommandName>(type: K, payload: Calls[K]["input"]): Promise<Calls[K]["output"]> {
  const reply: Reply<Calls[K]["output"]> = await chrome.runtime.sendMessage({ type, payload });
  if (!reply.ok) throw new Error(reply.error.message);
  return reply.data;
}
