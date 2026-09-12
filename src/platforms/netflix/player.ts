import type { ContentIdentity, NativeAction, PlaybackSnapshot, PlayerAdapter, SeekObservation } from "../../shared/contracts.ts";
import { notImplemented } from "../../shared/not-implemented.ts";

interface NetflixPlaybackApi {
  seek(milliseconds: number): void;
  getCurrentTime(): number;
}

declare global {
  interface Window {
    netflix?: {
      appContext?: { state?: { playerApp?: { getAPI(): {
        videoPlayer: {
          getAllPlayerSessionIds(): string[];
          getVideoPlayerBySessionId(id: string): NetflixPlaybackApi;
        };
      } } } };
    };
  }
}

export class NetflixPlayerAdapter implements PlayerAdapter {
  private static readonly pendingSeeks = new WeakMap<HTMLVideoElement, Promise<SeekObservation>>();
  readonly platform = "netflix";
  private readonly expectedUrl: string;

  constructor(expectedUrl: string) {
    this.expectedUrl = expectedUrl;
  }

  private getPlayer(): { player: NetflixPlaybackApi; video: HTMLVideoElement } {
    if (location.href !== this.expectedUrl) throw new Error("The Netflix video changed. Reload the page and load the matching skip file.");
    const app = window.netflix?.appContext?.state?.playerApp;
    if (!app) throw new Error("Netflix player API unavailable. Start a movie or episode first.");
    const manager = app.getAPI().videoPlayer;
    const sessions = manager.getAllPlayerSessionIds();
    if (sessions.length !== 1) throw new Error("Expected one Netflix player session. Close previews and reopen the video.");
    const video = document.querySelector<HTMLVideoElement>("video");
    if (!video || video.readyState < 1 || !Number.isFinite(video.duration) || video.duration <= 0) {
      throw new Error("Wait for the Netflix video to load.");
    }
    return { player: manager.getVideoPlayerBySessionId(sessions[0]), video };
  }

  readIdentity(): Promise<ContentIdentity> { notImplemented("NetflixPlayerAdapter.readIdentity"); }

  async readPlayback(): Promise<PlaybackSnapshot> {
    const { player, video } = this.getPlayer();
    const currentSeconds = player.getCurrentTime() / 1000;
    if (!Number.isFinite(currentSeconds) || currentSeconds < 0) throw new Error("Netflix returned an invalid playback position.");
    return { currentSeconds, durationSeconds: video.duration, paused: video.paused, ended: video.ended };
  }

  async seekTo(seconds: number): Promise<SeekObservation> {
    const { video } = this.getPlayer();
    const pending = NetflixPlayerAdapter.pendingSeeks.get(video);
    const seek = pending ? pending.then(() => this.performSeek(seconds)) : this.performSeek(seconds);
    NetflixPlayerAdapter.pendingSeeks.set(video, seek);
    try {
      return await seek;
    } finally {
      if (NetflixPlayerAdapter.pendingSeeks.get(video) === seek) NetflixPlayerAdapter.pendingSeeks.delete(video);
    }
  }

  private async performSeek(seconds: number): Promise<SeekObservation> {
    const { player, video } = this.getPlayer();
    if (!Number.isFinite(seconds) || seconds < 0 || seconds > video.duration) {
      throw new Error("Choose a timestamp within the video's duration.");
    }
    const milliseconds = Math.round(seconds * 1000);
    if (!video.seeking && player.getCurrentTime() === milliseconds) {
      return { requestedSeconds: seconds, observedSeconds: milliseconds / 1000 };
    }

    await new Promise<void>((resolve, reject) => {
      const cleanup = () => {
        clearTimeout(timeout);
        video.removeEventListener("seeked", onSeeked);
        video.removeEventListener("error", onError);
      };
      const onSeeked = () => { cleanup(); resolve(); };
      const onError = () => { cleanup(); reject(new Error("The Netflix video failed while seeking.")); };
      const timeout = setTimeout(() => {
        cleanup();
        reject(new Error("Netflix did not finish seeking within 10 seconds."));
      }, 10_000);
      video.addEventListener("seeked", onSeeked);
      video.addEventListener("error", onError);
      try {
        player.seek(milliseconds);
      } catch (error) {
        cleanup();
        reject(error);
      }
    });

    const { currentSeconds } = await this.readPlayback();
    if (Math.abs(currentSeconds - seconds) > 0.5) throw new Error(`Netflix sought to ${currentSeconds}s instead of ${seconds}s.`);
    return { requestedSeconds: seconds, observedSeconds: currentSeconds };
  }
  availableActions(): NativeAction[] { notImplemented("NetflixPlayerAdapter.availableActions"); }
  runNativeAction(_action: NativeAction): Promise<void> { notImplemented("NetflixPlayerAdapter.runNativeAction"); }
  onContentChange(_callback: (identity: ContentIdentity) => void): () => void { notImplemented("NetflixPlayerAdapter.onContentChange"); }
  onPlayerReplaced(_callback: () => void): () => void { notImplemented("NetflixPlayerAdapter.onPlayerReplaced"); }
  dispose(): void { notImplemented("NetflixPlayerAdapter.dispose"); }
}
