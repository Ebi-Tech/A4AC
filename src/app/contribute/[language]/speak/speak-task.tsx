"use client";

import { useRouter } from "next/navigation";
import { useCallback, useEffect, useRef, useState } from "react";
import { finalizeRecording, getSpeakItem, prepareUpload, skipSpeak, type SpeakItem, type SpeakMode } from "@/app/actions/speak";
import { SkipPanel, type SkipChoice } from "@/components/skip-panel";
import { btnPrimary, btnSecondary, muted } from "@/components/ui";
import {
  analyseClip,
  BLOCKING_WARNINGS,
  describeMicProblem,
  pickMimeType,
  WARNING_TEXT,
  type ClipCheck,
  type ClipLimits,
  type MicProblem,
} from "./audio";

type Language = { id: string; iso: string; name: string };
type Phase = "ready" | "starting" | "recording" | "checking" | "recorded";
type Clip = { blob: Blob; url: string; mimeType: string; check: ClipCheck; item: SpeakItem };
type JobState = "waiting" | "uploading" | "uploaded" | "failed";
type UploadJob = {
  id: string;
  blob: Blob | null;
  mimeType: string;
  durationMs: number;
  checks: ClipCheck;
  item: SpeakItem;
  state: JobState;
  attempts: number;
  nextTryAt: number;
  error?: string;
};

const MAX_BACKOFF_MS = 60_000;
const AUTO_STOP_MARGIN_MS = 250;
const PERMANENT_HTTP = new Set([400, 401, 403, 404, 409, 413, 415, 422]);

/**
 * Formats milliseconds as m:ss.
 *
 * @param ms Duration in milliseconds.
 * @returns The formatted time.
 */
function clock(ms: number): string {
  const seconds = Math.max(0, Math.floor(ms / 1000));
  return `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, "0")}`;
}

/**
 * The SPEAK task. Two modes: translate and speak (anchor sentence) and read
 * aloud (an existing translation). Records with MediaRecorder (WebM/Opus,
 * or MP4/AAC on iPhone), shows a level meter and timer, stops automatically
 * at the maximum length, checks the clip in the browser, then lets the user
 * play it back, re-record or submit. Submitted clips upload in the
 * background with retries while the next sentence is already on screen.
 *
 * @param props.language    Target language (id, ISO code, name).
 * @param props.initialMode Mode to start in.
 * @param props.initial     First item for that mode, loaded on the server.
 * @param props.limits      Minimum/maximum length and minimum speech in ms.
 * @param props.anchorNames Display names of anchor languages by ISO code.
 * @returns The task UI.
 */
export function SpeakTask({
  language,
  initialMode,
  initial,
  limits,
  anchorNames,
}: {
  language: Language;
  initialMode: SpeakMode;
  initial: SpeakItem | null;
  limits: ClipLimits;
  anchorNames: Record<string, string>;
}) {
  const router = useRouter();
  const [mode, setMode] = useState<SpeakMode>(initialMode);
  const [current, setCurrent] = useState<SpeakItem | null>(initial);
  const [upcoming, setUpcoming] = useState<SpeakItem | null>(null);
  const [loading, setLoading] = useState(false);
  const [phase, setPhase] = useState<Phase>("ready");
  const [clip, setClip] = useState<Clip | null>(null);
  const [elapsed, setElapsed] = useState(0);
  const [level, setLevel] = useState(0);
  const [micProblem, setMicProblem] = useState<MicProblem | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [skipOpen, setSkipOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [jobs, setJobs] = useState<UploadJob[]>([]);
  const [saved, setSaved] = useState(0);

  const jobsRef = useRef<UploadJob[]>([]);
  const runningRef = useRef(false);
  const retryTimerRef = useRef<number | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const recorderRef = useRef<MediaRecorder | null>(null);
  const audioContextRef = useRef<AudioContext | null>(null);
  const frameRef = useRef<number | null>(null);
  const startedAtRef = useRef(0);
  const prefetchingRef = useRef(false);
  const modeRef = useRef(mode);
  modeRef.current = mode;

  const pending = jobs.filter((job) => job.state === "waiting" || job.state === "uploading").length;
  const failed = jobs.filter((job) => job.state === "failed");
  const lastJob = jobs.at(-1);

  /**
   * Lists the sentence ids that must not be offered again yet: on screen,
   * prefetched, or recorded and still uploading.
   *
   * @param extra More ids to add.
   * @returns The ids.
   */
  const excludeIds = useCallback(
    (...extra: (string | undefined)[]) =>
      [current?.sentence_id, upcoming?.sentence_id, ...jobsRef.current.map((job) => job.item.sentence_id), ...extra].filter(
        (id): id is string => Boolean(id),
      ),
    [current, upcoming],
  );

  /**
   * Replaces one upload job's fields and re-renders.
   *
   * @param id    Job id.
   * @param patch Fields to change.
   */
  const updateJob = (id: string, patch: Partial<UploadJob>) => {
    jobsRef.current = jobsRef.current.map((job) => (job.id === id ? { ...job, ...patch } : job));
    setJobs(jobsRef.current);
  };

  /**
   * Uploads one clip: gets a signed upload URL, PUTs the file straight to
   * storage, then asks the server to create the recordings row. Network
   * problems are retried with growing pauses; rule failures are final.
   *
   * @param job The job to upload.
   * @returns True when the job finished (uploaded or failed for good).
   */
  const uploadOne = async (job: UploadJob): Promise<boolean> => {
    /**
     * Schedules another attempt with exponential backoff.
     *
     * @returns False (the job is not finished).
     */
    const retryLater = () => {
      const attempts = job.attempts + 1;
      updateJob(job.id, {
        state: "waiting",
        attempts,
        nextTryAt: Date.now() + Math.min(MAX_BACKOFF_MS, 2000 * 2 ** (attempts - 1)),
        error: "Waiting for a connection…",
      });
      return false;
    };

    if (!job.blob) return true;
    updateJob(job.id, { state: "uploading", error: undefined });
    try {
      const prepared = await prepareUpload(job.mimeType);
      if (!prepared.ok) {
        updateJob(job.id, { state: "failed", error: prepared.error, blob: null });
        return true;
      }
      const response = await fetch(prepared.signedUrl, {
        method: "PUT",
        headers: { "content-type": prepared.contentType, "x-upsert": "false" },
        body: job.blob,
      });
      if (!response.ok) {
        if (PERMANENT_HTTP.has(response.status)) {
          updateJob(job.id, { state: "failed", error: "This recording could not be stored (too large or an unsupported format).", blob: null });
          return true;
        }
        return retryLater();
      }
      const result = await finalizeRecording({
        languageId: language.id,
        item: job.item,
        path: prepared.path,
        mimeType: job.mimeType,
        durationMs: job.durationMs,
        checks: job.checks,
      });
      if (result.ok) {
        updateJob(job.id, { state: "uploaded", blob: null });
        setSaved((n) => n + 1);
        return true;
      }
      if (result.retry) return retryLater();
      updateJob(job.id, { state: "failed", error: result.error, blob: null });
      return true;
    } catch {
      return retryLater();
    }
  };

  /**
   * Works through the upload queue one clip at a time, and schedules itself
   * again when a clip is waiting for its next retry.
   */
  const runQueue = async () => {
    if (runningRef.current) return;
    runningRef.current = true;
    try {
      for (;;) {
        const due = jobsRef.current.find((job) => job.state === "waiting" && job.nextTryAt <= Date.now());
        if (!due) break;
        await uploadOne(due);
      }
    } finally {
      runningRef.current = false;
    }
    const later = jobsRef.current.filter((job) => job.state === "waiting");
    if (later.length && retryTimerRef.current === null) {
      const wait = Math.max(500, Math.min(...later.map((job) => job.nextTryAt)) - Date.now());
      retryTimerRef.current = window.setTimeout(() => {
        retryTimerRef.current = null;
        void runQueue();
      }, wait);
    }
  };

  useEffect(() => {
    if (!pending) return;
    const warn = (event: BeforeUnloadEvent) => {
      event.preventDefault();
      event.returnValue = "";
    };
    window.addEventListener("beforeunload", warn);
    return () => window.removeEventListener("beforeunload", warn);
  }, [pending]);

  useEffect(() => {
    const online = () => {
      jobsRef.current = jobsRef.current.map((job) => (job.state === "waiting" ? { ...job, nextTryAt: 0 } : job));
      setJobs(jobsRef.current);
      void runQueue();
    };
    window.addEventListener("online", online);
    return () => window.removeEventListener("online", online);
  });

  /**
   * Releases the microphone, the level meter and the animation loop.
   */
  const releaseMic = () => {
    if (frameRef.current !== null) cancelAnimationFrame(frameRef.current);
    frameRef.current = null;
    streamRef.current?.getTracks().forEach((track) => track.stop());
    streamRef.current = null;
    void audioContextRef.current?.close().catch(() => {});
    audioContextRef.current = null;
  };

  useEffect(() => () => releaseMic(), []);

  useEffect(() => {
    return () => {
      if (clip) URL.revokeObjectURL(clip.url);
    };
  }, [clip]);

  /**
   * Fetches the next item in the background (called when recording starts).
   */
  const prefetch = () => {
    if (upcoming || prefetchingRef.current || !current) return;
    prefetchingRef.current = true;
    const forMode = mode;
    getSpeakItem(language.id, forMode, excludeIds())
      .then((item) => {
        if (modeRef.current === forMode) setUpcoming(item);
      })
      .catch(() => {})
      .finally(() => {
        prefetchingRef.current = false;
      });
  };

  /**
   * Stops the recorder; the clip is processed in its onstop handler.
   */
  const stopRecording = () => {
    const recorder = recorderRef.current;
    if (recorder && recorder.state === "recording") recorder.stop();
  };

  /**
   * Asks for the microphone (mono, no echo cancellation or noise
   * suppression where the browser allows), starts MediaRecorder, the level
   * meter and the timer, and stops automatically at the maximum length.
   */
  const startRecording = async () => {
    if (!current || phase === "recording" || phase === "starting") return;
    setMicProblem(null);
    setNotice(null);
    setSkipOpen(false);
    if (!window.isSecureContext) return setMicProblem(describeMicProblem("insecure"));
    if (!navigator.mediaDevices?.getUserMedia || typeof MediaRecorder === "undefined") {
      return setMicProblem(describeMicProblem("unsupported"));
    }

    setPhase("starting");
    let stream: MediaStream;
    try {
      stream = await navigator.mediaDevices.getUserMedia({
        audio: {
          channelCount: { ideal: 1 },
          echoCancellation: { ideal: false },
          noiseSuppression: { ideal: false },
          autoGainControl: { ideal: false },
        },
      });
    } catch (error) {
      const name = (error as { name?: string })?.name;
      try {
        if (name !== "OverconstrainedError" && name !== "TypeError") throw error;
        stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      } catch (finalError) {
        setPhase("ready");
        return setMicProblem(describeMicProblem(finalError));
      }
    }
    streamRef.current = stream;

    const preferred = pickMimeType();
    let recorder: MediaRecorder;
    try {
      recorder = preferred ? new MediaRecorder(stream, { mimeType: preferred }) : new MediaRecorder(stream);
    } catch {
      recorder = new MediaRecorder(stream);
    }
    recorderRef.current = recorder;
    const chunks: Blob[] = [];
    const recordedItem = current;
    recorder.ondataavailable = (event) => {
      if (event.data.size > 0) chunks.push(event.data);
    };
    recorder.onstop = async () => {
      const duration = performance.now() - startedAtRef.current;
      releaseMic();
      setLevel(0);
      setPhase("checking");
      const mimeType = recorder.mimeType || preferred || "audio/webm";
      const blob = new Blob(chunks, { type: mimeType });
      const check = await analyseClip(blob, limits, duration);
      setClip({ blob, url: URL.createObjectURL(blob), mimeType, check, item: recordedItem });
      setPhase("recorded");
    };

    try {
      const Context = window.AudioContext ?? (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
      const context = new Context();
      const analyser = context.createAnalyser();
      analyser.fftSize = 1024;
      context.createMediaStreamSource(stream).connect(analyser);
      audioContextRef.current = context;
      const samples = new Float32Array(analyser.fftSize);
      let lastPaint = 0;
      const tick = (now: number) => {
        const since = now - startedAtRef.current;
        if (now - lastPaint > 80) {
          analyser.getFloatTimeDomainData(samples);
          let squares = 0;
          for (const sample of samples) squares += sample * sample;
          const db = 20 * Math.log10(Math.sqrt(squares / samples.length) || 1e-5);
          setLevel(Math.min(1, Math.max(0, (db + 60) / 50)));
          setElapsed(since);
          lastPaint = now;
        }
        if (since >= limits.maxMs - AUTO_STOP_MARGIN_MS) stopRecording();
        else frameRef.current = requestAnimationFrame(tick);
      };
      frameRef.current = requestAnimationFrame(tick);
    } catch {
      const timer = window.setInterval(() => {
        const since = performance.now() - startedAtRef.current;
        setElapsed(since);
        if (since >= limits.maxMs - AUTO_STOP_MARGIN_MS || recorder.state !== "recording") {
          window.clearInterval(timer);
          stopRecording();
        }
      }, 100);
    }

    startedAtRef.current = performance.now();
    setElapsed(0);
    recorder.start(250);
    setPhase("recording");
    prefetch();
  };

  /**
   * Shows the next item: the prefetched one if ready, otherwise the given
   * fallback or a fresh one from the server.
   *
   * @param following An item returned by the server, if any.
   */
  const advance = async (following?: SpeakItem | null) => {
    setClip(null);
    setPhase("ready");
    setSkipOpen(false);
    setNotice(null);
    if (upcoming) {
      setCurrent(upcoming);
      setUpcoming(following ?? null);
      return;
    }
    if (following !== undefined) {
      setCurrent(following);
      return;
    }
    setLoading(true);
    try {
      setCurrent(await getSpeakItem(language.id, mode, excludeIds()));
    } catch {
      setCurrent(null);
      setNotice("We could not load the next sentence. Please check your connection.");
    } finally {
      setLoading(false);
    }
  };

  /**
   * Queues the recorded clip for upload and moves on straight away.
   */
  const submit = () => {
    if (!clip) return;
    const job: UploadJob = {
      id: crypto.randomUUID(),
      blob: clip.blob,
      mimeType: clip.mimeType,
      durationMs: clip.check.duration_ms,
      checks: clip.check,
      item: clip.item,
      state: "waiting",
      attempts: 0,
      nextTryAt: 0,
    };
    jobsRef.current = [...jobsRef.current.filter((j) => j.state !== "uploaded"), job];
    setJobs(jobsRef.current);
    void runQueue();
    void advance();
  };

  /**
   * Skips (or reports) the item on screen.
   *
   * @param reason Why it is skipped.
   * @param note   Optional reason text for reports.
   */
  const skip = async (reason: SkipChoice, note?: string) => {
    if (!current) return;
    setBusy(true);
    try {
      const result = await skipSpeak({
        languageId: language.id,
        mode,
        sentenceId: current.sentence_id,
        reason,
        note,
        exclude: excludeIds(),
      });
      if (result.ok) await advance(result.following);
      else setNotice(result.error);
    } catch {
      setNotice("We could not reach the server. Please try again in a moment.");
    } finally {
      setBusy(false);
    }
  };

  /**
   * Switches between translate-and-speak and read-aloud.
   *
   * @param next The mode to show.
   */
  const switchMode = async (next: SpeakMode) => {
    if (next === mode || phase === "recording" || phase === "starting") return;
    setMode(next);
    setClip(null);
    setPhase("ready");
    setUpcoming(null);
    setSkipOpen(false);
    setLoading(true);
    window.history.replaceState(null, "", next === "read" ? "?mode=read" : window.location.pathname);
    try {
      setCurrent(await getSpeakItem(language.id, next, jobsRef.current.map((job) => job.item.sentence_id)));
    } catch {
      setCurrent(null);
    } finally {
      setLoading(false);
    }
  };

  /**
   * Leaves the task, asking first if clips are still waiting to upload.
   */
  const done = () => {
    if (pending && !window.confirm("A recording is still uploading. Leave anyway and lose it?")) return;
    router.push("/contribute");
  };

  const warnings = clip?.check.warnings ?? [];
  const blocked = warnings.some((w) => BLOCKING_WARNINGS.includes(w));
  const recording = phase === "recording";

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between gap-2">
        <div role="tablist" aria-label="Speak mode" className="flex rounded-xl border border-stone-300 p-1 dark:border-stone-700">
          {(["translate", "read"] as const).map((m) => (
            <button
              key={m}
              type="button"
              role="tab"
              aria-selected={mode === m}
              onClick={() => void switchMode(m)}
              disabled={recording || phase === "starting"}
              className={`min-h-11 rounded-lg px-3 text-sm font-medium ${mode === m ? "bg-emerald-700 text-white" : ""}`}
            >
              {m === "translate" ? "Translate and speak" : "Read aloud"}
            </button>
          ))}
        </div>
        <button type="button" onClick={done} className={`min-h-11 text-sm underline ${muted}`}>
          Done
        </button>
      </div>

      {loading ? (
        <p className={muted}>Loading…</p>
      ) : !current ? (
        <p className="text-lg">
          {mode === "read"
            ? `There is nothing in ${language.name} to read aloud right now. Try "Translate and speak".`
            : `There are no more sentences for you to record in ${language.name} right now. Please check back later.`}
        </p>
      ) : (
        <>
          <div className="rounded-2xl border border-stone-200 bg-white p-4 dark:border-stone-800 dark:bg-stone-900" data-sentence={current.sentence_id}>
            <p className={`text-xs font-medium tracking-wide uppercase ${muted}`}>
              {current.mode === "translate"
                ? (anchorNames[current.anchor_iso_code] ?? current.anchor_iso_code)
                : `Read this aloud in ${language.name}`}
            </p>
            <p className="mt-1 text-xl leading-snug font-semibold">{current.text}</p>
            {current.mode === "translate" && <p className={`mt-2 text-sm ${muted}`}>{`Say this in ${language.name}.`}</p>}
          </div>

          {micProblem && (
            <div role="alert" className="space-y-2 rounded-2xl bg-amber-50 p-4 text-amber-950 dark:bg-amber-950 dark:text-amber-100">
              <p className="font-semibold">{micProblem.title}</p>
              <ol className="list-decimal space-y-1 pl-5 text-sm">
                {micProblem.steps.map((step) => (
                  <li key={step}>{step}</li>
                ))}
              </ol>
            </div>
          )}

          {phase === "recorded" && clip ? (
            <div className="space-y-3">
              <audio controls src={clip.url} className="w-full" preload="auto" />
              {warnings.map((w) => (
                <p key={w} role="status" className="rounded-xl bg-amber-50 px-4 py-3 text-amber-950 dark:bg-amber-950 dark:text-amber-100">
                  {WARNING_TEXT[w]}
                </p>
              ))}
              <div className="flex gap-3">
                <button type="button" className={`${btnSecondary} flex-1`} onClick={() => void startRecording()}>
                  Re-record
                </button>
                <button type="button" className={`${btnPrimary} flex-[2]`} onClick={submit} disabled={blocked}>
                  {warnings.length && !blocked ? "Submit anyway" : "Submit"}
                </button>
              </div>
            </div>
          ) : (
            <div className="flex flex-col items-center gap-3 py-2">
              <p className={`text-center text-xs ${muted}`}>Don&apos;t say names, phone numbers or other personal details.</p>
              <button
                type="button"
                onClick={() => (recording ? stopRecording() : void startRecording())}
                disabled={phase === "starting" || phase === "checking"}
                aria-label={recording ? "Stop recording" : "Start recording"}
                aria-pressed={recording}
                className={`flex size-28 items-center justify-center rounded-full text-white shadow-lg focus-visible:outline-4 focus-visible:outline-offset-4 focus-visible:outline-emerald-700 disabled:opacity-60 ${
                  recording ? "bg-stone-900 dark:bg-stone-100 dark:text-stone-900" : "bg-red-600 hover:bg-red-700"
                }`}
              >
                {recording ? (
                  <span className="size-9 rounded-md bg-current" aria-hidden="true" />
                ) : (
                  <svg viewBox="0 0 24 24" className="size-12" aria-hidden="true" fill="currentColor">
                    <path d="M12 14a3 3 0 0 0 3-3V5a3 3 0 1 0-6 0v6a3 3 0 0 0 3 3Zm5-3a5 5 0 0 1-10 0H5a7 7 0 0 0 6 6.92V21h2v-3.08A7 7 0 0 0 19 11h-2Z" />
                  </svg>
                )}
              </button>
              <p className="text-base font-medium" aria-live="polite">
                {phase === "starting"
                  ? "Starting the microphone…"
                  : phase === "checking"
                    ? "Checking your recording…"
                    : recording
                      ? `Recording ${clock(elapsed)} / ${clock(limits.maxMs)}. Tap to stop.`
                      : "Tap to record"}
              </p>
              <div className="h-2 w-48 overflow-hidden rounded-full bg-stone-200 dark:bg-stone-800" aria-hidden="true">
                <div className="h-full bg-emerald-600 transition-[width] duration-75" style={{ width: `${Math.round(level * 100)}%` }} />
              </div>
            </div>
          )}

          {notice && (
            <p role="alert" className="rounded-xl bg-red-50 px-4 py-3 text-red-800 dark:bg-red-950 dark:text-red-200">
              {notice}
            </p>
          )}

          {!recording && phase !== "starting" && (
            <>
              <button type="button" className={btnSecondary} aria-expanded={skipOpen} onClick={() => setSkipOpen((o) => !o)} disabled={busy}>
                Skip
              </button>
              {skipOpen && <SkipPanel busy={busy} onSkip={(reason, note) => void skip(reason, note)} />}
            </>
          )}
        </>
      )}

      <div className="space-y-2 text-sm" aria-live="polite">
        {pending > 0 && (
          <p className="rounded-xl bg-stone-100 px-4 py-2 dark:bg-stone-800" data-upload-state="pending">
            {lastJob?.state === "uploading" ? "Uploading… " : ""}
            {pending === 1 ? "1 recording waiting to upload" : `${pending} recordings waiting to upload`}
            {lastJob?.error && lastJob.state === "waiting" ? ` · ${lastJob.error}` : ""}
          </p>
        )}
        {pending === 0 && lastJob?.state === "uploaded" && (
          <p className={muted} data-upload-state="uploaded">
            Uploaded ✓
          </p>
        )}
        {failed.map((job) => (
          <p key={job.id} role="alert" className="flex items-center justify-between gap-2 rounded-xl bg-red-50 px-4 py-2 text-red-800 dark:bg-red-950 dark:text-red-200" data-upload-state="failed">
            <span>A recording could not be saved: {job.error}</span>
            <button
              type="button"
              className="min-h-11 underline"
              onClick={() => {
                jobsRef.current = jobsRef.current.filter((j) => j.id !== job.id);
                setJobs(jobsRef.current);
              }}
            >
              Dismiss
            </button>
          </p>
        ))}
        {saved > 0 && <p className={`text-center ${muted}`}>{saved} recorded this session</p>}
      </div>
    </div>
  );
}
