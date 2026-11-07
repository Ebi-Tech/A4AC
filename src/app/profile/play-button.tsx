"use client";

import { useRef, useState } from "react";
import { getPlaybackUrl } from "@/app/actions/speak";

/**
 * Play/stop button for one of the user's recordings. The short-lived signed
 * URL is only requested when the user taps play, so listing recordings costs
 * no audio downloads.
 *
 * @param props.recordingId The recording to play.
 * @returns The button.
 */
export function PlayButton({ recordingId }: { recordingId: string }) {
  const [state, setState] = useState<"idle" | "loading" | "playing" | "error">("idle");
  const audioRef = useRef<HTMLAudioElement | null>(null);

  /**
   * Starts playback (fetching a signed URL first), or stops it.
   */
  const toggle = async () => {
    if (state === "playing") {
      audioRef.current?.pause();
      setState("idle");
      return;
    }
    setState("loading");
    try {
      const url = await getPlaybackUrl(recordingId);
      if (!url) return setState("error");
      const audio = new Audio(url);
      audioRef.current = audio;
      audio.onended = () => setState("idle");
      audio.onerror = () => setState("error");
      await audio.play();
      setState("playing");
    } catch {
      setState("error");
    }
  };

  return (
    <button
      type="button"
      onClick={() => void toggle()}
      className="inline-flex min-h-11 items-center gap-2 rounded-xl border border-stone-300 px-4 text-sm font-medium dark:border-stone-700"
      aria-label={state === "playing" ? "Stop" : "Play recording"}
    >
      {state === "loading" ? "Loading…" : state === "playing" ? "■ Stop" : state === "error" ? "Could not play" : "▶ Play"}
    </button>
  );
}
