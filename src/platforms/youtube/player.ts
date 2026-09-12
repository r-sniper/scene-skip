import type { ContentIdentity, NativeAction, PlaybackSnapshot, PlayerAdapter, SeekObservation } from "../../shared/contracts.ts";
import { notImplemented } from "../../shared/not-implemented.ts";

export class YouTubePlayerAdapter implements PlayerAdapter {
  readonly platform = "youtube";

  readIdentity(): Promise<ContentIdentity> { notImplemented("YouTubePlayerAdapter.readIdentity"); }
  readPlayback(): Promise<PlaybackSnapshot> { notImplemented("YouTubePlayerAdapter.readPlayback"); }
  seekTo(_seconds: number): Promise<SeekObservation> { notImplemented("YouTubePlayerAdapter.seekTo"); }
  availableActions(): NativeAction[] { notImplemented("YouTubePlayerAdapter.availableActions"); }
  runNativeAction(_action: NativeAction): Promise<void> { notImplemented("YouTubePlayerAdapter.runNativeAction"); }
  onContentChange(_callback: (identity: ContentIdentity) => void): () => void { notImplemented("YouTubePlayerAdapter.onContentChange"); }
  onPlayerReplaced(_callback: () => void): () => void { notImplemented("YouTubePlayerAdapter.onPlayerReplaced"); }
  dispose(): void { notImplemented("YouTubePlayerAdapter.dispose"); }
}
