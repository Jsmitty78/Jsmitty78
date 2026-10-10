import { useCallback, useEffect, useRef, useState } from "react";

/**
 * Tap-to-dictate question entry using the browser's own speech recognition.
 * Speech only ever becomes text in the question box; it is never submitted, corrected or stored by Sprink.
 */
export type DictationStatus =
  | "idle" | "requesting" | "listening" | "stopping" | "ready" | "cancelled"
  | "denied" | "unsupported" | "unavailable" | "no_speech" | "failed";

/** The subset of the Web Speech API used here. Chrome/Edge/Safari expose it, sometimes only with a `webkit` prefix. */
export interface RecognitionLike {
  lang: string; continuous: boolean; interimResults: boolean; maxAlternatives: number;
  start(): void; stop(): void; abort(): void;
  onstart: ((e: Event) => void) | null;
  onaudiostart: ((e: Event) => void) | null;
  onresult: ((e: RecognitionResultEvent) => void) | null;
  onerror: ((e: { error: string }) => void) | null;
  onend: ((e: Event) => void) | null;
}
export interface RecognitionResultEvent { resultIndex?: number; results: ArrayLike<ArrayLike<{ transcript: string }> & { isFinal: boolean }> }
export type RecognitionCtor = new () => RecognitionLike;

export function recognitionCtor(scope: unknown = globalThis): RecognitionCtor | null {
  const s = scope as { SpeechRecognition?: RecognitionCtor; webkitSpeechRecognition?: RecognitionCtor } | undefined;
  return s?.SpeechRecognition ?? s?.webkitSpeechRecognition ?? null;
}

/** Browser error codes from SpeechRecognitionErrorEvent.error. */
export function statusForError(code: string): DictationStatus {
  switch (code) {
    case "not-allowed": return "denied";
    case "no-speech": return "no_speech";
    case "service-not-allowed": case "network": case "language-not-supported": return "unavailable";
    case "aborted": return "cancelled";
    default: return "failed"; // audio-capture, bad-grammar and anything a browser adds later
  }
}

export interface DictationHandlers {
  status(status: DictationStatus, errorCode?: string): void;
  /** What has been heard so far, while listening. Display only. */
  heard(text: string): void;
  /** The finished transcript. Called at most once, never after a cancel. */
  done(text: string): void;
}

/** Wait this long for the browser to finish after "Stop" before using what was already heard. */
export const STOP_GRACE_MS = 4000;

/** One recognition session. Single utterance: browsers end it after a pause, or when the user taps Stop. */
export function startDictation(Ctor: RecognitionCtor, lang: string, on: DictationHandlers) {
  let finished = false, errored: string | null = null, finalText = "", interimText = "";
  let grace: ReturnType<typeof setTimeout> | undefined;
  const rec = new Ctor();
  const detach = () => { rec.onstart = rec.onaudiostart = rec.onresult = rec.onerror = rec.onend = null; clearTimeout(grace); };
  const finish = () => {
    if (finished) return;
    finished = true; detach();
    const text = `${finalText} ${interimText}`.replace(/\s+/g, " ").trim();
    if (errored && !(errored === "no-speech" && text)) { on.status(statusForError(errored), errored); return; }
    if (!text) { on.status("no_speech"); return; }
    on.done(text); on.status("ready");
  };
  rec.lang = lang; rec.continuous = false; rec.interimResults = true; rec.maxAlternatives = 1;
  const listening = () => { if (!finished && !stopping) on.status("listening"); };
  let stopping = false;
  rec.onstart = listening;
  rec.onaudiostart = listening;
  rec.onresult = e => {
    // Rebuild from the whole result list: some browsers (iOS Safari) repeat or revise earlier results.
    let f = "", i = "";
    for (let n = 0; n < e.results.length; n++) { const r = e.results[n]; const t = r[0]?.transcript ?? ""; if (r.isFinal) f += `${t} `; else i += `${t} `; }
    finalText = f.trim(); interimText = i.trim();
    on.heard(`${finalText} ${interimText}`.trim());
  };
  rec.onerror = e => { errored = e.error || "failed"; };
  rec.onend = finish;
  on.status("requesting");
  try { rec.start(); }
  catch { finished = true; detach(); on.status("failed", "start-failed"); }
  return {
    /** Finish now and keep what was heard. */
    stop() {
      if (finished || stopping) return;
      stopping = true; on.status("stopping");
      try { rec.stop(); } catch { finish(); return; }
      grace = setTimeout(finish, STOP_GRACE_MS);
    },
    /** Discard everything heard in this session. */
    cancel() {
      if (finished) return;
      finished = true; detach();
      try { rec.abort(); } catch { /* already ended */ }
      on.status("cancelled");
    },
    /** Silent teardown on unmount or navigation. */
    dispose() {
      if (finished) return;
      finished = true; detach();
      try { rec.abort(); } catch { /* already ended */ }
    },
  };
}

export const isActive = (s: DictationStatus) => s === "requesting" || s === "listening" || s === "stopping";

export function speechLang(locale: string) { return locale === "ja" ? "ja-JP" : "en-US"; }

/** React wrapper: exposes the status, the live "heard" preview and start/stop/cancel. Always stops on unmount. */
export function useDictation(lang: string, onDone: (text: string) => void) {
  const [Ctor] = useState(() => recognitionCtor(typeof window === "undefined" ? undefined : window));
  const [status, setStatus] = useState<DictationStatus>(Ctor ? "idle" : "unsupported");
  const [heard, setHeard] = useState("");
  const session = useRef<{ token: object; control: ReturnType<typeof startDictation> } | null>(null);
  const done = useRef(onDone);
  done.current = onDone;
  const start = useCallback(() => {
    if (!Ctor) { setStatus("unsupported"); return; }
    session.current?.control.dispose();
    session.current = null;
    setHeard("");
    const token = {};
    let current = true;
    const control = startDictation(Ctor, lang, {
      status: s => { if (!current) return; setStatus(s); if (!isActive(s)) { current = false; if (session.current?.token === token) session.current = null; } },
      heard: text => { if (current) setHeard(text); },
      done: text => { if (current) done.current(text); },
    });
    if (current) session.current = { token, control };
  }, [Ctor, lang]);
  const stop = useCallback(() => session.current?.control.stop(), []);
  const cancel = useCallback(() => { session.current?.control.cancel(); setHeard(""); }, []);
  const reset = useCallback(() => { if (!session.current) setStatus(Ctor ? "idle" : "unsupported"); }, [Ctor]);
  useEffect(() => () => { session.current?.control.dispose(); session.current = null; }, []);
  // Leaving the page or switching apps ends listening; keep what was already heard.
  useEffect(() => {
    const hide = () => { if (document.visibilityState === "hidden") session.current?.control.stop(); };
    document.addEventListener("visibilitychange", hide);
    window.addEventListener("pagehide", hide);
    return () => { document.removeEventListener("visibilitychange", hide); window.removeEventListener("pagehide", hide); };
  }, []);
  return { supported: !!Ctor, status, heard, start, stop, cancel, reset };
}
