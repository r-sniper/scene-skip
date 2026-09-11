# Scene Skip

Chrome extension prototype for watching cuts described by ordinary SRT files.

Netflix is the current validation target. Prime Video and YouTube features will be enabled after Netflix is confirmed working.

## Available now

- Popup detects Netflix / Prime Video / YouTube, with manual selection available.
- **Netflix debug controls:** expand the section, enter a timestamp, and click **Seek**.
- **Netflix player overlays:** independently show the current timestamp and highlight loaded skip segments above the native seek bar. Overlay switches and the loaded filename are restored when reopening the popup.
- **Netflix SRT loading:** select a file to automatically skip its ranges. The popup shows its filename, segment count and current skip setting.
- **Enable / disable skipping:** use the button beside the file summary. The file and setting stay in the video tab when the popup closes; the button does not pause the video.
- Netflix debug and automatic skips share the same player. Each completed tick is followed by a 250 ms delay.
- Prime/YouTube controls are marked planned and disabled. Earlier seek probes remain in source; file playback and overlays are unimplemented. Intro/recap/next controls and preferences are also pending.

## Run

- Prerequisites: Node.js 24+, pnpm 11, desktop Chrome.

```sh
pnpm install --frozen-lockfile
pnpm build
```

1. Open `chrome://extensions` and enable **Developer mode**.
2. Click **Load unpacked**, select this project's **dist** folder, and pin Scene Skip.
3. Open a Netflix movie or episode, start playback, then open Scene Skip.
4. For Netflix, click **Load SRT** under **Skip scenes**. The file must match the title, country and release you are watching.
   The upload control changes to the filename and segment count. Click **Disable skipping** or **Enable skipping** as needed.
5. To test a manual Netflix seek, expand **Debug controls**, enter `90`, `01:30`, or `00:01:30.500`, and click **Seek**.
6. On Netflix, enable **Show timestamp** for the observed player time, or **Highlight skip segments** after loading an SRT. Green segments follow the native seek bar and its visibility; both overlays leave the player's controls clickable.

- Rebuild, reload the extension, and reload the video tab after code changes. The debug section starts collapsed; overlays stay active until switched off or the video page reloads.
- Start with ad-free, on-demand Netflix content.
- Netflix uses a private player API and waits for seek completion. Live compatibility still needs manual verification.

## Prototype limits

- One skip file per video document. Disable skipping to watch normally; reload the video page to change files.
- Empty/invalid SRT and out-of-runtime ranges fail explicitly. Loading validates playback and duration, then confirms the file without waiting for the first automatic seek.
- Disabling prevents new automatic skips, including from a pending playback read. A seek already requested may still finish. Debug seek and overlay settings are independent of this button.
- Paused playback stays paused; skipping begins when playback resumes.
- A URL change or player failure ends the loop. Playback errors appear in the video page's console and the popup. While open, the popup refreshes loaded-file status once a second between actions, so later failures show without reopening it. Reload the page to restart after a failure.
- If a status request fails, the popup keeps the filename, shows **Status unavailable**, and stops refreshing. Reopen the popup to read status again.
- File state restores independently of debug settings. Offset controls, content identification and file replacement are pending.
- Player overlays currently support Netflix only. Their clock samples observed playback every 100 ms, without extrapolation; errors stop updates and appear in the player, console and reopened popup. Live overlay placement and fullscreen behavior need manual verification.

## Develop

```sh
pnpm check
pnpm test
pnpm build
```

- Popup logs: right-click popup → **Inspect**.
- Worker logs: `chrome://extensions` → Scene Skip → **service worker**.
- Netflix playback errors: open DevTools on the **video tab** → **Console**.
- No runtime dependencies, account, server, analytics, or remote code.
- Current permissions: `activeTab` and `scripting`.
- Shared playback, debug-display and capability contracts keep provider code separate. See the architecture document for the boundary a later player must implement.

## Design

- [LLD, engine contract and call diagrams](ARCH.md)
- [Platform seeking and Chrome guidance](docs/PLATFORM-NOTES.md)
- [Test checklist and evidence](docs/TESTING.md)
- [v0 product scope](SPEC-v0.md)
- [Coding guidelines](AGENTS.md)

License: [MIT](LICENSE).
