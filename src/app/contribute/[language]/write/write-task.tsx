"use client";

import Link from "next/link";
import { useCallback, useEffect, useRef, useState } from "react";
import { getNextSentence, skipSentence, submitTranslation, type QueueItem, type WriteResult } from "@/app/actions/write";
import { SkipPanel, type SkipChoice } from "@/components/skip-panel";
import { btnPrimary, btnSecondary, input, muted } from "@/components/ui";

type Language = { id: string; iso: string; name: string; specialCharacters: string[] };
type Notice = { kind: "error" | "break"; text: string } | null;

/**
 * Reads a value from browser storage, returning null when storage is
 * unavailable (private mode, blocked cookies, quota).
 *
 * @param storage "local" or "session".
 * @param key     Storage key.
 * @returns The stored string, or null.
 */
function readStorage(storage: "local" | "session", key: string): string | null {
  try {
    return (storage === "local" ? window.localStorage : window.sessionStorage).getItem(key);
  } catch {
    return null;
  }
}

/**
 * Writes (or with value null, removes) a value in browser storage, silently
 * doing nothing when storage is unavailable.
 *
 * @param storage "local" or "session".
 * @param key     Storage key.
 * @param value   Value to store, or null to remove.
 */
function writeStorage(storage: "local" | "session", key: string, value: string | null): void {
  try {
    const target = storage === "local" ? window.localStorage : window.sessionStorage;
    if (value === null || value === "") target.removeItem(key);
    else target.setItem(key, value);
  } catch {
    /* storage unavailable: the page keeps working without drafts */
  }
}

/**
 * The interactive WRITE task: shows the anchor sentence, a text box with
 * tap-to-insert letters, Submit and Skip (with report). Prefetches the next
 * sentence while the user types, keeps a draft in browser storage, and shows
 * a gentle count of sentences written this session.
 *
 * @param props.language    Target language (id, ISO code, name, special characters).
 * @param props.initial     First sentence, loaded on the server (null when none).
 * @param props.anchorNames Display names of anchor languages by ISO code.
 * @returns The task UI.
 */
export function WriteTask({
  language,
  initial,
  anchorNames,
}: {
  language: Language;
  initial: QueueItem | null;
  anchorNames: Record<string, string>;
}) {
  const [current, setCurrent] = useState<QueueItem | null>(initial);
  const [upcoming, setUpcoming] = useState<QueueItem | null>(null);
  const [text, setText] = useState("");
  const [written, setWritten] = useState(0);
  const [notice, setNotice] = useState<Notice>(null);
  const [busy, setBusy] = useState(false);
  const [skipOpen, setSkipOpen] = useState(false);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const prefetching = useRef(false);

  const counterKey = `a4ac:written:${language.id}`;
  const draftKey = current ? `a4ac:draft:${language.id}:${current.sentence_id}` : null;

  useEffect(() => {
    setWritten(Number(readStorage("session", counterKey)) || 0);
  }, [counterKey]);

  useEffect(() => {
    setText(draftKey ? (readStorage("local", draftKey) ?? "") : "");
  }, [draftKey]);

  /**
   * Starts fetching the next sentence in the background if none is waiting.
   */
  const prefetch = useCallback(() => {
    if (!current || upcoming || prefetching.current) return;
    prefetching.current = true;
    getNextSentence(language.id, [current.sentence_id])
      .then((item) => setUpcoming(item))
      .catch(() => {})
      .finally(() => {
        prefetching.current = false;
      });
  }, [current, upcoming, language.id]);

  /**
   * Updates the text, saves it as a draft and triggers the prefetch.
   *
   * @param value New text.
   */
  const changeText = (value: string) => {
    setText(value);
    if (draftKey) writeStorage("local", draftKey, value);
    if (value.trim()) prefetch();
  };

  /**
   * Moves to the next sentence after a successful submit or skip, using the
   * prefetched one when available.
   *
   * @param result The successful action result.
   */
  const advance = (result: Extract<WriteResult, { ok: true }>) => {
    if (draftKey) writeStorage("local", draftKey, null);
    if (upcoming) {
      setCurrent(upcoming);
      setUpcoming(result.following);
    } else {
      setCurrent(result.following);
      setUpcoming(null);
    }
    setText("");
    setNotice(null);
    setSkipOpen(false);
    textareaRef.current?.focus();
  };

  /**
   * Sends the translation; on success counts it and shows the next sentence.
   */
  const submit = async () => {
    if (!current || busy) return;
    if (!text.trim()) {
      setNotice({ kind: "error", text: "Please write something before submitting." });
      return;
    }
    setBusy(true);
    try {
      const result = await submitTranslation({
        languageId: language.id,
        sentenceId: current.sentence_id,
        seenAnchorLanguageId: current.anchor_language_id,
        text,
        exclude: [current.sentence_id, upcoming?.sentence_id ?? ""],
      });
      if (result.ok) {
        const next = written + 1;
        setWritten(next);
        writeStorage("session", counterKey, String(next));
        advance(result);
      } else {
        setNotice({ kind: result.rule === "rate_limit" ? "break" : "error", text: result.error });
      }
    } catch {
      setNotice({ kind: "error", text: "We could not reach the server. Your text is saved here; try again in a moment." });
    } finally {
      setBusy(false);
    }
  };

  /**
   * Skips (or reports) the current sentence and shows the next one.
   *
   * @param reason Why the sentence is skipped.
   * @param note   Optional reason text for reports.
   */
  const skip = async (reason: SkipChoice, note?: string) => {
    if (!current || busy) return;
    setBusy(true);
    try {
      const result = await skipSentence({
        languageId: language.id,
        sentenceId: current.sentence_id,
        reason,
        note,
        exclude: [current.sentence_id, upcoming?.sentence_id ?? ""],
      });
      if (result.ok) advance(result);
      else setNotice({ kind: "error", text: result.error });
    } catch {
      setNotice({ kind: "error", text: "We could not reach the server. Please try again in a moment." });
    } finally {
      setBusy(false);
    }
  };

  /**
   * Inserts a special character at the cursor and keeps focus in the box.
   *
   * @param character The character(s) to insert.
   */
  const insertCharacter = (character: string) => {
    const box = textareaRef.current;
    if (!box) return;
    box.focus();
    box.setRangeText(character, box.selectionStart, box.selectionEnd, "end");
    changeText(box.value);
  };

  if (!current) {
    return (
      <div className="space-y-4">
        <p className="text-lg">
          {written > 0 ? `Thank you! You wrote ${written} this session. ` : ""}
          There are no more sentences for you in {language.name} right now. Please check back later.
        </p>
        <Link href="/contribute" className={btnSecondary}>
          Back to contribute
        </Link>
      </div>
    );
  }

  const anchorName = anchorNames[current.anchor_iso_code] ?? current.anchor_iso_code;

  return (
    <form
      className="space-y-4"
      onSubmit={(event) => {
        event.preventDefault();
        void submit();
      }}
    >
      <div className="rounded-2xl border border-stone-200 bg-white p-4 dark:border-stone-800 dark:bg-stone-900">
        <p className={`text-xs font-medium tracking-wide uppercase ${muted}`}>{anchorName}</p>
        <p lang={current.anchor_iso_code === "fra" ? "fr" : "en"} className="mt-1 text-xl leading-snug font-semibold">
          {current.anchor_text}
        </p>
      </div>

      <div>
        <label htmlFor="translation" className="mb-1 block text-base font-medium">
          {`Write this in ${language.name}`}
        </label>
        <p id="translation-help" className={`mb-2 text-sm ${muted}`}>
          Write it the way you would naturally say it. Spell it the way you normally write.
        </p>
        <textarea
          id="translation"
          ref={textareaRef}
          value={text}
          onChange={(e) => changeText(e.target.value)}
          onFocus={(e) => {
            const box = e.currentTarget;
            window.setTimeout(() => box.scrollIntoView({ block: "center", behavior: "smooth" }), 300);
          }}
          onKeyDown={(e) => {
            if (e.key === "Enter" && !e.shiftKey && !e.nativeEvent.isComposing) {
              e.preventDefault();
              void submit();
            }
          }}
          rows={3}
          maxLength={1000}
          autoCapitalize="sentences"
          autoCorrect="off"
          autoComplete="off"
          spellCheck={false}
          enterKeyHint="send"
          aria-describedby="translation-help"
          className={`${input} min-h-24 py-3 text-lg`}
        />
      </div>

      {language.specialCharacters.length > 0 && (
        <div role="group" aria-label={`${language.name} letters`} className="flex flex-wrap gap-2">
          {language.specialCharacters.map((character) => (
            <button
              key={character}
              type="button"
              onMouseDown={(e) => e.preventDefault()}
              onClick={() => insertCharacter(character)}
              className="min-h-11 min-w-11 rounded-lg border border-stone-300 bg-white px-2 text-lg dark:border-stone-700 dark:bg-stone-900"
              aria-label={`Insert ${character}`}
            >
              {character}
            </button>
          ))}
        </div>
      )}

      {notice && (
        <p
          role={notice.kind === "error" ? "alert" : "status"}
          className={
            notice.kind === "break"
              ? "rounded-xl bg-amber-50 px-4 py-3 text-amber-900 dark:bg-amber-950 dark:text-amber-200"
              : "rounded-xl bg-red-50 px-4 py-3 text-red-800 dark:bg-red-950 dark:text-red-200"
          }
        >
          {notice.text}
        </p>
      )}

      <div className="sticky bottom-0 -mx-4 flex gap-3 border-t border-stone-200 bg-[var(--background)] px-4 py-3 dark:border-stone-800">
        <button
          type="button"
          className={`${btnSecondary} flex-1 sm:flex-none`}
          aria-expanded={skipOpen}
          onClick={() => setSkipOpen((open) => !open)}
          disabled={busy}
        >
          Skip
        </button>
        <button type="submit" className={`${btnPrimary} flex-[2] sm:flex-none`} disabled={busy}>
          {busy ? "Saving…" : "Submit"}
        </button>
      </div>

      {skipOpen && <SkipPanel busy={busy} onSkip={(reason, note) => void skip(reason, note)} />}

      <p className={`text-center text-sm ${muted}`} aria-live="polite">
        {written > 0 ? `${written} written this session` : " "}
      </p>
    </form>
  );
}
