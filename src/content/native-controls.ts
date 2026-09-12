import type { NativeAction, PlatformPreferences, PlaybackSnapshot } from "../shared/contracts.ts";
import { notImplemented } from "../shared/not-implemented.ts";

export class NativeControls {
  configure(_preferences: PlatformPreferences): void { notImplemented("NativeControls.configure"); }
  nextAction(_snapshot: PlaybackSnapshot, _available: NativeAction[]): NativeAction | null { notImplemented("NativeControls.nextAction"); }
  recordAction(_action: NativeAction): void { notImplemented("NativeControls.recordAction"); }
  reset(): void { notImplemented("NativeControls.reset"); }
}
