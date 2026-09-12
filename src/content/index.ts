import type { ContentCommand } from "../shared/messages.ts";
import type { SessionState } from "../shared/contracts.ts";
import { notImplemented } from "../shared/not-implemented.ts";

export async function handleContentCommand(_command: ContentCommand): Promise<SessionState | void> {
  notImplemented("handleContentCommand");
}
