import type { ContentIdentity, NativeAction, PlaybackSnapshot, PlayerAdapter, SeekObservation } from "../../shared/contracts.ts";
import { notImplemented } from "../../shared/not-implemented.ts";

export class PrimePlayerAdapter implements PlayerAdapter {
  readonly platform = "prime";

  readIdentity(): Promise<ContentIdentity> { notImplemented("PrimePlayerAdapter.readIdentity"); }
  readPlayback(): Promise<PlaybackSnapshot> { notImplemented("PrimePlayerAdapter.readPlayback"); }
  seekTo(_seconds: number): Promise<SeekObservation> { notImplemented("PrimePlayerAdapter.seekTo"); }
  availableActions(): NativeAction[] { notImplemented("PrimePlayerAdapter.availableActions"); }
  runNativeAction(_action: NativeAction): Promise<void> { notImplemented("PrimePlayerAdapter.runNativeAction"); }
  onContentChange(_callback: (identity: ContentIdentity) => void): () => void { notImplemented("PrimePlayerAdapter.onContentChange"); }
  onPlayerReplaced(_callback: () => void): () => void { notImplemented("PrimePlayerAdapter.onPlayerReplaced"); }
  dispose(): void { notImplemented("PrimePlayerAdapter.dispose"); }
}
