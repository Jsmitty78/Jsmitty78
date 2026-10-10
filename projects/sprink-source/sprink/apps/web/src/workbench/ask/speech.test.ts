import { afterEach, describe, expect, it, vi } from "vitest";
import { recognitionCtor, startDictation, statusForError, STOP_GRACE_MS, type DictationStatus, type RecognitionLike } from "./speech.js";

/** Stand-in for the browser recognizer; tests drive its events. No microphone involved. */
class FakeRecognition implements RecognitionLike {
  static last: FakeRecognition;
  lang = ""; continuous = true; interimResults = false; maxAlternatives = 5;
  onstart: RecognitionLike["onstart"] = null; onaudiostart: RecognitionLike["onaudiostart"] = null;
  onresult: RecognitionLike["onresult"] = null; onerror: RecognitionLike["onerror"] = null; onend: RecognitionLike["onend"] = null;
  started = false; stopped = false; aborted = false;
  constructor() { FakeRecognition.last = this; }
  start() { this.started = true; }
  stop() { this.stopped = true; }
  abort() { this.aborted = true; }
  begin() { this.onstart?.(new Event("start")); }
  results(...parts: Array<[string, boolean]>) { this.onresult?.({ results: parts.map(([t, f]) => Object.assign([{ transcript: t }], { isFinal: f })) }); }
  fail(error: string) { this.onerror?.({ error }); }
  end() { this.onend?.(new Event("end")); }
}

function session() {
  const statuses: DictationStatus[] = [], heard: string[] = [], done: string[] = [];
  const control = startDictation(FakeRecognition, "en-US", { status: s => statuses.push(s), heard: t => heard.push(t), done: t => done.push(t) });
  return { control, rec: FakeRecognition.last, statuses, heard, done };
}

afterEach(() => vi.useRealTimers());

describe("speech recognition detection", () => {
  it("uses the standard or webkit-prefixed constructor and reports none otherwise", () => {
    expect(recognitionCtor({ SpeechRecognition: FakeRecognition })).toBe(FakeRecognition);
    expect(recognitionCtor({ webkitSpeechRecognition: FakeRecognition })).toBe(FakeRecognition);
    expect(recognitionCtor({})).toBeNull();
    expect(recognitionCtor(undefined)).toBeNull();
  });
  it("maps browser errors to states a fitter can act on", () => {
    expect(statusForError("not-allowed")).toBe("denied");
    expect(statusForError("service-not-allowed")).toBe("unavailable");
    expect(statusForError("network")).toBe("unavailable");
    expect(statusForError("no-speech")).toBe("no_speech");
    expect(statusForError("audio-capture")).toBe("failed");
    expect(statusForError("something-new")).toBe("failed");
  });
});

describe("dictation session", () => {
  it("asks for one utterance with interim results, then reports permission, listening and the final text", () => {
    const s = session();
    expect(s.rec).toMatchObject({ lang: "en-US", continuous: false, interimResults: true, maxAlternatives: 1, started: true });
    expect(s.statuses).toEqual(["requesting"]);
    s.rec.begin();
    s.rec.results(["Does NFPA 13R", false]);
    s.rec.results(["Does NFPA 13R allow CPVC", true]);
    s.rec.end();
    expect(s.statuses).toEqual(["requesting", "listening", "ready"]);
    expect(s.heard).toEqual(["Does NFPA 13R", "Does NFPA 13R allow CPVC"]);
    expect(s.done).toEqual(["Does NFPA 13R allow CPVC"]);
  });

  it("returns the words exactly as recognized, without correcting technical terms", () => {
    const s = session();
    s.rec.begin();
    s.rec.results(["one and a half inch schedule forty NPT", true]);
    s.rec.end();
    expect(s.done).toEqual(["one and a half inch schedule forty NPT"]);
  });

  it("rebuilds from the full result list when a browser repeats earlier results", () => {
    const s = session();
    s.rec.begin();
    s.rec.results(["branch line", true]);
    s.rec.results(["branch line", true], ["hanger spacing", false]);
    s.rec.end();
    expect(s.done).toEqual(["branch line hanger spacing"]);
  });

  it("Stop keeps what was heard so far, even if the browser never finalizes it", () => {
    vi.useFakeTimers();
    const s = session();
    s.rec.begin();
    s.rec.results(["riser obstruction", false]);
    s.control.stop();
    expect(s.rec.stopped).toBe(true);
    expect(s.statuses.at(-1)).toBe("stopping");
    vi.advanceTimersByTime(STOP_GRACE_MS);
    expect(s.done).toEqual(["riser obstruction"]);
    expect(s.statuses.at(-1)).toBe("ready");
    s.rec.end();
    expect(s.done).toHaveLength(1);
  });

  it("Cancel discards everything and ignores late events", () => {
    const s = session();
    s.rec.begin();
    s.rec.results(["half heard", false]);
    s.control.cancel();
    s.rec.results(["half heard words", true]);
    s.rec.end();
    expect(s.rec.aborted).toBe(true);
    expect(s.done).toEqual([]);
    expect(s.statuses.at(-1)).toBe("cancelled");
  });

  it("reports denied permission and does not produce text", () => {
    const s = session();
    s.rec.fail("not-allowed");
    s.rec.end();
    expect(s.statuses).toEqual(["requesting", "denied"]);
    expect(s.done).toEqual([]);
  });

  it("reports no speech when the session ends silently", () => {
    const s = session();
    s.rec.begin();
    s.rec.end();
    expect(s.statuses.at(-1)).toBe("no_speech");
    const t = session();
    t.rec.begin(); t.rec.fail("no-speech"); t.rec.end();
    expect(t.statuses.at(-1)).toBe("no_speech");
  });

  it("reports recognition failure without leaking the transcript", () => {
    const s = session();
    s.rec.begin();
    s.rec.results(["partial", false]);
    s.rec.fail("audio-capture");
    s.rec.end();
    expect(s.statuses.at(-1)).toBe("failed");
    expect(s.done).toEqual([]);
  });

  it("reports failure when the browser refuses to start", () => {
    class Throws extends FakeRecognition { start() { throw new Error("InvalidStateError"); } }
    const statuses: DictationStatus[] = [];
    startDictation(Throws, "en-US", { status: s => statuses.push(s), heard() {}, done() {} });
    expect(statuses).toEqual(["requesting", "failed"]);
  });

  it("dispose stops the recognizer silently (unmount, navigation)", () => {
    const s = session();
    s.rec.begin();
    s.control.dispose();
    s.rec.results(["after unmount", true]);
    s.rec.end();
    expect(s.rec.aborted).toBe(true);
    expect(s.statuses).toEqual(["requesting", "listening"]);
    expect(s.done).toEqual([]);
  });
});
