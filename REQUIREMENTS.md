# Scene Skip - requirements

Requirements and delivery phases · 17 November 2026.

Baseline: the user confirmed the earlier Netflix implementation worked. Phases 0 and 1 now use the common controller and isolated tab state; live verification of this refactor remains with the user.

## Goal

Watch a no-song, rewatch, or editorial cut by loading a local SRT file describing scenes to omit. The original video stays on its streaming service.

## Phase 0 - preserve the working Netflix baseline

1. User should be able to open the extension on a Netflix movie/episode and read its playback position.
2. User should be able to seek to an entered timestamp and see the observed result or a clear error, preserving play/pause state.

Manual seek means entering a timestamp in Debug controls and clicking Seek. It is a way to check the player integration, not a separate skipping mechanism. Keep existing SRT skipping working while reorganizing the design.

## Phase 1 - common controller and Netflix cut playback

1. User should be able to load one ordinary UTF-8 SRT skip file for the current title and see its filename and range count. Each entry supplies an interval and a plain-text reason.
2. User should be able to enable/disable skipping. Playing inside a marked interval seeks to its end; paused playback waits until resumed. Rewinding can trigger it again.
3. User should be able to close/reopen the popup without losing the file or setting. Tabs operate independently; later ranges retain original-video timestamps.
4. User should see clear file/player errors. Title changes, page reloads, and tab closure clear the active file so it cannot affect another title.
5. User should check the file's title, country, and edition against its source; SRT cannot establish an exact release match automatically.

Validation target: foreground 1× playback requests skips within 500 ms of interval entry and lands within 500 ms of its end; measure buffering separately. Frame-accurate filtering and arbitrarily short intervals are not guaranteed.

## Later phases - one increment at a time

- Phase 2: replace/clear files without reloading; inspect ranges, reasons, and total omitted time; overall timing offset. Existing clock/segment overlays remain available.
- Phase 3: Prime Video and YouTube after separate live verification; reconnect replacement players for the same title.
- Phase 4: independent intro/recap/next controls, off by default, with preferences saved per platform. Enable only supported controls.

## Technical requirements

1. Chrome Manifest V3; packaged code, local file processing, and access limited to the selected supported tab. No account, server, or analytics required.
2. One common controller runs the playback loop and calls a small Player interface. Each platform implements that interface. A requested seek must never be presented as observed completion.

Range authoring, an in-extension community catalog, ad skipping, downloads, and mobile/TV support are outside these phases. An external collection of shareable cuts can follow later.

Design and local testing: [technical design](ARCH.md).
