import type { Reply, SeekObservation } from "../shared/contracts.ts";

export interface VideoSelectors {
  video: string;
  advertisement?: string;
}

// Chrome serializes this function without its imports or closure, so helpers must stay inside it.
export async function seekHtmlVideo(seconds: number, selectors: VideoSelectors, expectedUrl: string): Promise<Reply<SeekObservation>> {
  try {
    if (location.href !== expectedUrl) throw new Error("The video page changed. Reopen the popup.");
    if (selectors.advertisement && document.querySelector(selectors.advertisement)) {
      throw new Error("Wait for the advertisement to finish before seeking.");
    }
    const videos = [...document.querySelectorAll<HTMLVideoElement>(selectors.video)].filter(video => {
      const bounds = video.getBoundingClientRect();
      return bounds.width > 0 && bounds.height > 0 && video.readyState >= 1;
    });
    if (videos.length !== 1) throw new Error("Open one visible video and wait for it to load.");
    const video = videos[0];
    if (!Number.isFinite(video.duration)) throw new Error("Live streams are not supported.");
    if (seconds < 0 || seconds >= video.duration) throw new Error("Choose a timestamp before the video's end.");
    video.currentTime = seconds;
    const positionSampleDelayMs = 350;
    await new Promise(resolve => setTimeout(resolve, positionSampleDelayMs));
    return { ok: true, data: { requestedSeconds: seconds, observedSeconds: video.currentTime } };
  } catch (error) {
    return { ok: false, error: { code: "SEEK_FAILED", message: String(error) } };
  }
}
