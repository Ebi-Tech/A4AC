export type ClipCheck = {
  source: "client";
  version: 1;
  decoded: boolean;
  duration_ms: number;
  sample_rate?: number;
  channels?: number;
  rms_dbfs?: number;
  peak_dbfs?: number;
  speech_ms?: number;
  clipping_pct?: number;
  warnings: ClipWarning[];
};

export type ClipWarning = "too_short" | "too_long" | "too_quiet" | "little_speech" | "clipping";

export type ClipLimits = { minMs: number; maxMs: number; minSpeechMs: number };

export type MicProblem = { title: string; steps: string[] };

const CANDIDATE_TYPES = [
  "audio/webm;codecs=opus",
  "audio/webm",
  "audio/ogg;codecs=opus",
  "audio/mp4;codecs=mp4a.40.2",
  "audio/mp4",
];

const FRAME_SECONDS = 0.02;
const QUIET_PEAK_DBFS = -35;
const SPEECH_FLOOR_DBFS = -45;
const CLIPPING_LEVEL = 0.999;
const CLIPPING_WARN_PCT = 1;

/**
 * Picks the best recording format this browser supports: WebM/Opus first,
 * then Ogg/Opus, then MP4/AAC (iPhone Safari).
 *
 * @returns A MIME type for MediaRecorder, or "" to let the browser choose.
 */
export function pickMimeType(): string {
  if (typeof MediaRecorder === "undefined" || typeof MediaRecorder.isTypeSupported !== "function") return "";
  return CANDIDATE_TYPES.find((type) => MediaRecorder.isTypeSupported(type)) ?? "";
}

/**
 * Converts a linear amplitude to decibels relative to full scale.
 *
 * @param value Amplitude between 0 and 1.
 * @returns dBFS, floored at -100.
 */
function toDb(value: number): number {
  return value > 0 ? Math.max(-100, 20 * Math.log10(value)) : -100;
}

/**
 * Decodes a recorded clip with the Web Audio API and measures it: duration,
 * overall and peak loudness, how much of it is speech (20 ms frames clearly
 * above the background level) and the share of clipped samples. Adds kind
 * warnings for clips that are too short or long, too quiet, mostly silent or
 * distorted. If the browser cannot decode the clip, returns the timer
 * duration and no loudness figures.
 *
 * @param blob        The recorded audio.
 * @param limits      Minimum and maximum length and minimum speech, in ms.
 * @param fallbackMs  Duration measured by the timer, used if decoding fails.
 * @returns The check result, marked source "client".
 */
export async function analyseClip(blob: Blob, limits: ClipLimits, fallbackMs: number): Promise<ClipCheck> {
  let check: ClipCheck = { source: "client", version: 1, decoded: false, duration_ms: Math.round(fallbackMs), warnings: [] };
  try {
    const Context = window.AudioContext ?? (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
    const context = new Context();
    try {
      const buffer = await context.decodeAudioData(await blob.arrayBuffer());
      const data = buffer.getChannelData(0);
      const frameSize = Math.max(1, Math.round(buffer.sampleRate * FRAME_SECONDS));
      const frameDbs: number[] = [];
      let sumSquares = 0;
      let peak = 0;
      let clipped = 0;

      for (let start = 0; start < data.length; start += frameSize) {
        let frameSquares = 0;
        const end = Math.min(start + frameSize, data.length);
        for (let i = start; i < end; i++) {
          const sample = data[i];
          const magnitude = Math.abs(sample);
          frameSquares += sample * sample;
          if (magnitude > peak) peak = magnitude;
          if (magnitude >= CLIPPING_LEVEL) clipped++;
        }
        sumSquares += frameSquares;
        frameDbs.push(toDb(Math.sqrt(frameSquares / (end - start))));
      }

      const sorted = [...frameDbs].sort((a, b) => a - b);
      const noiseFloor = sorted[Math.floor(sorted.length * 0.1)] ?? -100;
      const speechThreshold = Math.max(SPEECH_FLOOR_DBFS, noiseFloor + 10);
      const speechFrames = frameDbs.filter((db) => db > speechThreshold).length;

      check = {
        source: "client",
        version: 1,
        decoded: true,
        duration_ms: Math.round(buffer.duration * 1000),
        sample_rate: buffer.sampleRate,
        channels: buffer.numberOfChannels,
        rms_dbfs: Math.round(toDb(Math.sqrt(sumSquares / Math.max(1, data.length))) * 10) / 10,
        peak_dbfs: Math.round(toDb(peak) * 10) / 10,
        speech_ms: Math.round(speechFrames * FRAME_SECONDS * 1000),
        clipping_pct: Math.round((clipped / Math.max(1, data.length)) * 10000) / 100,
        warnings: [],
      };
    } finally {
      void context.close();
    }
  } catch {
    /* decoding unsupported for this format: keep the timer duration */
  }

  if (check.duration_ms < limits.minMs) check.warnings.push("too_short");
  if (check.duration_ms > limits.maxMs) check.warnings.push("too_long");
  if (check.decoded) {
    if ((check.peak_dbfs ?? 0) < QUIET_PEAK_DBFS) check.warnings.push("too_quiet");
    else if ((check.speech_ms ?? 0) < limits.minSpeechMs) check.warnings.push("little_speech");
    if ((check.clipping_pct ?? 0) > CLIPPING_WARN_PCT) check.warnings.push("clipping");
  }
  return check;
}

export const WARNING_TEXT: Record<ClipWarning, string> = {
  too_short: "That was a little short. Please record the whole sentence.",
  too_long: "That was longer than we can keep. Please try saying it a bit faster.",
  too_quiet: "We could hardly hear you. Try again a little closer to the microphone, somewhere quiet.",
  little_speech: "We could only hear a little speech. Please make sure you say the whole sentence.",
  clipping: "It sounds a bit loud and distorted. Try holding the phone a little further away.",
};

export const BLOCKING_WARNINGS: ClipWarning[] = ["too_short", "too_long"];

/**
 * Works out which platform instructions to show for microphone problems.
 *
 * @returns "iphone", "android" or "desktop".
 */
function platform(): "iphone" | "android" | "desktop" {
  const ua = navigator.userAgent;
  if (/iPhone|iPad|iPod/i.test(ua) || (/Macintosh/.test(ua) && navigator.maxTouchPoints > 1)) return "iphone";
  if (/Android/i.test(ua)) return "android";
  return "desktop";
}

/**
 * Turns a getUserMedia / MediaRecorder failure into a friendly message with
 * short, platform-specific steps.
 *
 * @param error The thrown error, or "insecure" / "unsupported".
 * @returns A title and a few steps to fix it.
 */
export function describeMicProblem(error: unknown): MicProblem {
  const name = typeof error === "string" ? error : (error as { name?: string })?.name ?? "";
  const where = platform();

  if (name === "insecure") {
    return {
      title: "Recording needs a secure (https) connection.",
      steps: ["Open this site with an https:// address and try again."],
    };
  }
  if (name === "unsupported") {
    return {
      title: "This browser cannot record audio.",
      steps: ["Please use a recent version of Chrome (Android or computer) or Safari (iPhone)."],
    };
  }
  if (name === "NotFoundError" || name === "OverconstrainedError" || name === "NotReadableError") {
    return {
      title: name === "NotReadableError" ? "Your microphone is busy." : "We could not find a microphone.",
      steps:
        name === "NotReadableError"
          ? ["Close other apps that might be using the microphone (calls, voice notes), then try again."]
          : ["Check that a microphone is connected and switched on, then try again."],
    };
  }

  const steps: Record<typeof where, string[]> = {
    android: [
      "Tap the icon to the left of the web address (or ⋮ › Settings › Site settings).",
      "Choose Permissions › Microphone › Allow.",
      "Reload the page.",
    ],
    iphone: [
      "Tap “aA” in the address bar, then Website Settings.",
      "Set Microphone to Allow (or open the Settings app › Safari › Microphone).",
      "Reload the page.",
    ],
    desktop: [
      "Click the icon to the left of the web address and allow the microphone.",
      "On a Mac, also check System Settings › Privacy & Security › Microphone for your browser.",
      "Reload the page.",
    ],
  };
  return { title: "Microphone access is blocked.", steps: steps[where] };
}
