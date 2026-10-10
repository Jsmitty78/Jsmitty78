import { tr, useLocale } from "../locale.js";
import { useCallback, useEffect, useRef, useState } from "react";
import { Button, Callout, Icon, Spinner } from "../ui.js";
import { askApi, type AskAnswer, type Citation, type SourceDocument } from "./askApi.js";
import { AskTimeoutError, describeAskError, type AskProblem } from "./askErrors.js";
import { isActive, speechLang, useDictation, type DictationStatus } from "./speech.js";
import { useAuthedUrl } from "./uploads.js";
import "./rule-search.css";

const SUGGESTED = [
  "What does Spears FlameGuard require for deburring a solvent-cement pipe joint?",
  "What installation instructions are available for TYCO TY-FRB sprinklers?",
];
/** Matches the server limit in apps/server/src/sources/ask.ts. */
export const MAX_QUESTION = 1000;
/** The server allows its search service 30 s; give up a little after that. */
export const ASK_TIMEOUT_MS = 45_000;
const DRAFT_KEY = "sprink.ask.draft";

/** Voice text is added after what is already typed, never in place of it. */
export function appendTranscript(existing: string, transcript: string): string {
  const heard = transcript.trim();
  if (!heard) return existing;
  const kept = existing.replace(/\s+$/, "");
  return kept ? `${kept} ${heard}` : heard;
}

const readDraft = () => { try { return sessionStorage.getItem(DRAFT_KEY) ?? ""; } catch { return ""; } };
const writeDraft = (text: string) => { try { if (text) sessionStorage.setItem(DRAFT_KEY, text); else sessionStorage.removeItem(DRAFT_KEY); } catch { /* storage blocked: keep in memory only */ } };
const coarsePointer = () => typeof matchMedia === "function" && matchMedia("(pointer: coarse)").matches;

type Phase = "idle" | "loading" | "done" | "error";
interface Undo { before: string; after: string; message: string }

/** Shared, operator-maintained reference search, independent of a work package. */
export function AskPanel({ onClose, embedded = false, onAuthFailure }: { embedded?: boolean; onClose: () => void; onAuthFailure?: () => void }) {
  const locale = useLocale();
  const [question, setQuestion] = useState(readDraft);
  const [asked, setAsked] = useState("");
  const [phase, setPhase] = useState<Phase>("idle");
  const [answer, setAnswer] = useState<AskAnswer | null>(null);
  const [problem, setProblem] = useState<AskProblem | null>(null);
  const [viewing, setViewing] = useState<Citation | null>(null);
  const [docs, setDocs] = useState<SourceDocument[] | null>(null);
  const [libraryError, setLibraryError] = useState(false);
  const [undo, setUndo] = useState<Undo | null>(null);
  const input = useRef<HTMLTextAreaElement>(null);
  const root = useRef<HTMLDivElement>(null);
  const latest = useRef(question);
  latest.current = question;
  // A ref, not state: two taps in the same frame must not start two requests.
  const inflight = useRef<{ id: number; controller: AbortController } | null>(null);
  const seq = useRef(0);

  const [voiceHelp, setVoiceHelp] = useState(false);
  const { status: voice, heard, start: startVoice, stop: stopVoice, cancel: cancelVoice, reset: resetVoice } = useDictation(speechLang(locale), text => {
    const before = latest.current, after = appendTranscript(before, text);
    setQuestion(after);
    setUndo({ before, after, message: "Voice text added. Check technical terms and measurements before asking." });
  });
  const listening = isActive(voice);

  useEffect(() => { writeDraft(question); }, [question]);
  useEffect(() => {
    let live = true;
    askApi.documents().then(r => { if (live) setDocs(r.documents); }).catch(() => { if (live) setLibraryError(true); });
    if (!coarsePointer()) input.current?.focus();
    return () => { live = false; };
  }, []);
  useEffect(() => () => { seq.current++; inflight.current?.controller.abort(); }, []);
  // Grow with the question instead of scrolling inside a two-line box.
  useEffect(() => {
    const el = input.current;
    if (!el) return;
    el.style.height = "auto";
    el.style.height = `${Math.min(el.scrollHeight + 2, 260)}px`;
  }, [question]);
  // Embedded in a work package, this panel is hidden rather than unmounted when another tab opens.
  useEffect(() => {
    const el = root.current;
    if (!listening || !el || typeof ResizeObserver === "undefined") return;
    const watch = new ResizeObserver(() => { if (!el.getClientRects().length) cancelVoice(); });
    watch.observe(el);
    return () => watch.disconnect();
  }, [listening, cancelVoice]);
  useEffect(() => {
    const k = (e: KeyboardEvent) => {
      if (e.key !== "Escape") return;
      if (listening) { cancelVoice(); return; }
      if (!embedded) onClose();
    };
    window.addEventListener("keydown", k);
    return () => window.removeEventListener("keydown", k);
  }, [onClose, embedded, listening, cancelVoice]);

  const run = useCallback(async (text: string) => {
    const q = text.trim();
    if (!q || q.length > MAX_QUESTION || inflight.current) return;
    const id = ++seq.current, controller = new AbortController();
    let timedOut = false;
    const timer = setTimeout(() => { timedOut = true; controller.abort(); }, ASK_TIMEOUT_MS);
    inflight.current = { id, controller };
    setAsked(q); setPhase("loading"); setProblem(null); setAnswer(null); setViewing(null); setUndo(null); resetVoice(); setVoiceHelp(false);
    try {
      const result = await askApi.search(q, controller.signal);
      if (id !== seq.current) return;
      setAnswer(result); setPhase("done");
    } catch (e) {
      if (id !== seq.current) return;
      setProblem(describeAskError(timedOut ? new AskTimeoutError() : e)); setPhase("error");
    } finally {
      clearTimeout(timer);
      if (inflight.current?.id === id) inflight.current = null;
    }
  }, [resetVoice]);
  const cancelRequest = () => {
    seq.current++;
    inflight.current?.controller.abort();
    inflight.current = null;
    setPhase(answer ? "done" : "idle");
    input.current?.focus();
  };
  const askAnother = () => {
    if (question) setUndo({ before: question, after: "", message: "Question cleared." });
    setQuestion(""); resetVoice();
    root.current?.scrollIntoView?.({ block: "start" });
    window.scrollTo?.({ top: 0 });
    input.current?.focus();
  };
  const clear = () => {
    setUndo({ before: question, after: "", message: "Question cleared." });
    setQuestion(""); resetVoice(); input.current?.focus();
  };

  const busy = phase === "loading";
  const tooLong = question.trim().length > MAX_QUESTION;
  const canAsk = !!question.trim() && !tooLong && !busy && !listening;
  const showUndo = undo && question === undo.after && !listening;

  return <div ref={root} className={`sk-ask ${embedded ? "is-embedded" : ""} ${phase === "idle" ? "is-new-question" : "has-answer"}`} role={embedded ? "region" : "dialog"} aria-label={tr("Ask Sprink")}>
    <div className="sk-ask-inner">
      {!embedded && <button type="button" className="sk-close fa-icon-btn" onClick={onClose} aria-label={tr("Close Ask Sprink")}><Icon name="x" /></button>}
      <div className="sk-compose">
        <header className="sk-intro">
          <span className="sk-eyebrow">{tr("SPRINK REFERENCE LIBRARY")}</span>
          <h1>{tr("Ask a sprinkler code question")}</h1>
          <p>{tr("Answers come only from the references in Sprink's library, with the page they came from.")}</p>
        </header>
        <form className="sk-form" role="search" aria-label={tr("Ask Sprink")} onSubmit={e => { e.preventDefault(); if (canAsk) void run(question); }}>
          <label className="sk-label" htmlFor="ask-q">{tr("Your question")}</label>
          <div className="sk-field">
            <textarea id="ask-q" ref={input} rows={3} maxLength={MAX_QUESTION} value={question} enterKeyHint="search" autoCapitalize="sentences" spellCheck
              aria-describedby="ask-q-help" aria-invalid={tooLong || undefined}
              placeholder={tr("e.g. Minimum clearance below an NFPA 13 pendent sprinkler")}
              onChange={e => { setQuestion(e.target.value); if (voice === "ready" || voice === "no_speech" || voice === "cancelled") resetVoice(); }}
              onKeyDown={e => { if (e.key === "Enter" && !e.shiftKey && !e.nativeEvent.isComposing && !coarsePointer()) { e.preventDefault(); if (canAsk) void run(question); } }} />
            {question && !listening && <button type="button" className="sk-clear" onClick={clear} aria-label={tr("Clear question")}><Icon name="x" size={18} /></button>}
          </div>
          <VoiceStatus status={voice} heard={heard} explainUnsupported={voiceHelp} onCancel={cancelVoice} />
          {showUndo && <div className="sk-undo" role="status">
            <span>{tr(undo.message)}</span>
            <button type="button" onClick={() => { setQuestion(undo.before); setUndo(null); resetVoice(); input.current?.focus(); }}>{tr("Undo")}</button>
          </div>}
          <div className="sk-actions">
            <MicButton status={voice} disabled={busy} onStart={() => { if (voice === "unsupported") setVoiceHelp(true); else startVoice(); }} onStop={stopVoice} onCancel={cancelVoice} />
            <p id="ask-q-help" className={`sk-help ${tooLong ? "is-error" : ""}`}>
              {tooLong ? tr("Shorten the question to {max} characters ({count} now).", { max: MAX_QUESTION, count: question.trim().length })
                : listening ? tr("Finish speaking, then check the text before asking.")
                : question.length > MAX_QUESTION - 100 ? `${question.length} / ${MAX_QUESTION}`
                : <span className="sk-only-fine">{tr("Enter to ask · Shift + Enter for a new line")}</span>}
            </p>
            <button type="submit" className="sk-submit" disabled={!canAsk} aria-busy={busy || undefined}>
              {busy ? <span className="fa-spinner" aria-hidden="true" /> : <Icon name="ask" size={20} />}
              <span>{busy ? tr("Searching…") : tr("Ask Sprink")}</span>
            </button>
          </div>
        </form>
      </div>

      <div className="sk-results">
        <p className="sr-only" role="status" aria-live="polite">{phase === "done" && answer ? answer.status === "no_source" ? tr("No supporting source found") : tr("{count} supporting sources found", { count: answer.sources.length }) : ""}</p>
        {phase !== "idle" && <div className="sk-asked"><span>{tr("Results for")}</span><p>{asked}</p></div>}
        {phase === "loading" && <div className="sk-loading" role="status">
          <span className="fa-spinner" aria-hidden="true" />
          <div><strong>{tr("Searching the reference library…")}</strong><small>{tr("This can take up to 30 seconds.")}</small></div>
          <button type="button" onClick={cancelRequest}>{tr("Cancel")}</button>
        </div>}
        {phase === "error" && problem && <Callout tone="red" title={tr(problem.title)}
          action={problem.kind === "auth" ? onAuthFailure && <Button onClick={onAuthFailure}>{tr("Reconnect")}</Button> : problem.retry ? <Button onClick={() => void run(asked)}>{tr("Try again")}</Button> : <Button onClick={() => input.current?.focus()}>{tr("Edit question")}</Button>}>
          {tr(problem.detail)}
        </Callout>}
        {phase === "done" && answer && <Answer a={answer} viewing={viewing} onView={setViewing} onEdit={() => input.current?.focus()} />}
        {phase === "done" && answer && <div className="sk-next"><Button onClick={askAnother}>{tr("Ask another question")}</Button></div>}

        {phase === "idle" && <>
          <div className="sk-suggest"><span className="sk-eyebrow">{tr("TRY A QUESTION")}</span>
            {SUGGESTED.map(q => <button key={q} type="button" disabled={listening} onClick={() => { setQuestion(q); void run(q); }}>{tr(q)}</button>)}
          </div>
          {libraryError && <Callout tone="neutral" title={tr("Could not load the list of references")}>{tr("You can still ask. The list is only for reference.")}</Callout>}
          {docs && <details className="sk-library"><summary>{tr("References in the library")} ({docs.length})</summary>
            {docs.length ? <ul>{docs.map(d => <li key={d.id}><strong>{d.title}</strong><small>{[d.publisher, d.edition].filter(Boolean).join(" · ")}</small></li>)}</ul>
              : <p>{tr("No references are available yet. The library administrator must add sources.")}</p>}
          </details>}
        </>}
      </div>
    </div>
  </div>;
}

function MicIcon({ off = false }: { off?: boolean }) {
  return <svg className="fa-icon" width={20} height={20} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
    <rect x="9" y="3" width="6" height="11" rx="3" /><path d="M5.5 11a6.5 6.5 0 0 0 13 0M12 17.5V21M9 21h6" />{off && <path d="M4 4l16 16" />}
  </svg>;
}

function MicButton({ status, disabled, onStart, onStop, onCancel }: { status: DictationStatus; disabled: boolean; onStart: () => void; onStop: () => void; onCancel: () => void }) {
  if (status === "listening") return <button type="button" className="sk-mic is-listening" onClick={onStop} aria-label={tr("Stop listening")}><span className="sk-stop" aria-hidden="true" /><span>{tr("Stop")}</span></button>;
  if (status === "requesting") return <button type="button" className="sk-mic is-listening" onClick={onCancel} aria-label={tr("Cancel voice entry")}><span className="fa-spinner" aria-hidden="true" /><span>{tr("Cancel")}</span></button>;
  if (status === "stopping") return <button type="button" className="sk-mic" disabled aria-label={tr("Finishing voice entry")}><span className="fa-spinner" aria-hidden="true" /><span>{tr("Wait")}</span></button>;
  const off = status === "unsupported" || status === "denied" || status === "unavailable";
  return <button type="button" className={`sk-mic ${off ? "is-off" : ""}`} disabled={disabled} onClick={onStart}
    aria-label={off ? tr("Voice entry unavailable") : tr("Speak your question")} aria-describedby={off ? "ask-voice-status" : undefined}>
    <MicIcon off={off} /><span>{tr("Speak")}</span>
  </button>;
}

const VOICE_MESSAGES: Partial<Record<DictationStatus, { tone: "live" | "info" | "problem"; text: string }>> = {
  requesting: { tone: "live", text: "Allow microphone access if your browser asks." },
  listening: { tone: "live", text: "Speak your question, then tap Stop." },
  stopping: { tone: "live", text: "Finishing the transcript…" },
  cancelled: { tone: "info", text: "Voice entry cancelled. Nothing was added." },
  no_speech: { tone: "info", text: "No speech was heard. Tap Speak to try again, or type your question." },
  denied: { tone: "problem", text: "Microphone access is blocked. Allow the microphone for this site in your browser settings (on iPhone: Settings › Safari › Microphone), or type your question." },
  unsupported: { tone: "problem", text: "Voice entry isn't available in this browser. Type your question, or open Sprink in Safari or Chrome." },
  unavailable: { tone: "problem", text: "Speech recognition isn't available right now. Check your connection; on iPhone, make sure Dictation is turned on (Settings › General › Keyboard). You can type your question." },
  failed: { tone: "problem", text: "Voice entry stopped unexpectedly. Try again, or type your question." },
};

/** Listening is always shown in words and with the Stop control, not by colour alone. */
function VoiceStatus({ status, heard, explainUnsupported, onCancel }: { status: DictationStatus; heard: string; explainUnsupported: boolean; onCancel: () => void }) {
  const m = VOICE_MESSAGES[status];
  const active = isActive(status);
  // An unsupported browser explains itself once the microphone is tapped, instead of on every visit.
  const show = m && (status !== "unsupported" || explainUnsupported);
  return <div id="ask-voice-status" className={`sk-voice tone-${m?.tone ?? "none"} ${show ? "" : "is-empty"}`} role="status" aria-live="polite" data-status={status}>
    {show && <>
      {active && <span className="sk-rec-dot" aria-hidden="true" />}
      <div>
        {active && <strong>{status === "requesting" ? tr("Starting the microphone…") : status === "stopping" ? tr("Stopped listening") : tr("Listening")}</strong>}
        <span>{tr(m.text)}</span>
        {active && heard && <q className="sk-heard">{heard}</q>}
      </div>
      {(status === "listening" || status === "stopping") && <button type="button" onClick={onCancel}>{tr("Cancel")}</button>}
    </>}
  </div>;
}

/** One entry per original page, even when several indexed passages matched it. */
export function sourceHits(a: AskAnswer): Citation[] {
  const candidates = a.sources.filter(s => s.excerpt || !a.sources.some(x => x.excerpt && x.docId === s.docId && x.pageStart === s.pageStart));
  return candidates.filter((s, i, all) => all.findIndex(x => s.excerpt ? x.key === s.key : x.docId === s.docId && (s.pageStart !== null ? x.pageStart === s.pageStart : x.key === s.key)) === i).sort((a, b) => Number(!!b.excerpt) - Number(!!a.excerpt));
}
const pages = (c: Citation) => c.pageStart === null ? null : c.pageEnd !== null && c.pageEnd !== c.pageStart ? tr("pp. {from}–{to}", { from: c.pageStart, to: c.pageEnd }) : tr("p. {page}", { page: c.pageStart });

export function Answer({ a, viewing, onView, onEdit }: { a: AskAnswer; viewing: Citation | null; onView: (c: Citation) => void; onEdit?: () => void }) {
  const hits = sourceHits(a);
  const selected = viewing ?? hits[0];
  const viewer = useRef<HTMLDivElement>(null);
  const list = useRef<HTMLOListElement>(null);
  if (a.status === "no_source" || !hits.length) return <NoSource a={a} onEdit={onEdit} />;
  const view = (c: Citation) => { onView(c); requestAnimationFrame(() => viewer.current?.scrollIntoView?.({ block: "start", behavior: "smooth" })); };
  const back = () => list.current?.querySelector<HTMLElement>(`[data-key="${CSS.escape(selected.key)}"] button`)?.focus();
  const edition = a.context.edition;
  return <section className="sk-result" aria-label={tr("Answer and supporting sources")}>
    <div className="sk-answer">
      <h2>{tr("Answer")}</h2>
      <p className="sk-summary">{a.summary}</p>
      {edition.status === "unknown" && edition.reason && <p className="sk-caveat"><Icon name="alert" size={16} /><span>{edition.reason}</span></p>}
      {a.conflicts.length > 0 && <div className="sk-conflicts" role="note">
        <strong>{tr("Sources disagree")}</strong>
        {a.conflicts.map(c => <div key={c.topic}><p>{c.topic}</p><ul>{c.items.map(i => <li key={i.key}><b>{i.label}</b> {i.position}</li>)}</ul><small>{c.resolution}</small></div>)}
      </div>}
      {a.unresolved.length > 0 && <div className="sk-unresolved"><strong>{tr("Not supported by a source")}</strong><ul>{a.unresolved.map(u => <li key={u.id}>{u.text}{u.reason && <small> — {u.reason}</small>}</li>)}</ul></div>}
      {a.missing.length > 0 && <div className="sk-unresolved"><strong>{tr("Information needed")}</strong><ul>{a.missing.map(m => <li key={m}>{m}</li>)}</ul></div>}
    </div>
    <h2 className="sk-sources-title">{tr("Supporting sources")} <span>{hits.length}</span></h2>
    <ol className="sk-sources" ref={list}>
      {hits.map(s => <SourceCard key={s.key} c={s} selected={selected?.key === s.key} onView={() => view(s)} />)}
    </ol>
    <div ref={viewer} className="sk-viewer-anchor">{selected && <OriginalPage key={selected.key} citation={selected} onBack={back} />}</div>
  </section>;
}

function SourceCard({ c, selected, onView }: { c: Citation; selected: boolean; onView: () => void }) {
  const p = pages(c);
  const section = [c.sectionId, c.heading].filter(Boolean).join(" · ");
  return <li data-key={c.key}><article className={`sk-source ${selected ? "is-selected" : ""}`}>
    <div className="sk-source-tags">
      {c.typeLabel && <span className="sk-tag">{c.typeLabel}</span>}
      {c.label && c.label !== c.typeLabel && <span className="sk-tag is-quiet">{c.label}</span>}
      {c.demonstration && <span className="sk-tag is-amber">{tr("Sample")}</span>}
    </div>
    <h3>{c.docTitle}</h3>
    <dl className="sk-facts">
      {c.publisher && <div><dt>{tr("Publisher")}</dt><dd>{c.publisher}</dd></div>}
      {c.edition && <div><dt>{tr("Edition")}</dt><dd>{c.edition}</dd></div>}
      {section && <div className="is-wide"><dt>{tr("Section")}</dt><dd>{section}</dd></div>}
      {p && <div><dt>{tr("Page")}</dt><dd>{p}</dd></div>}
    </dl>
    {c.quote ? <p className="sk-quote">{c.quote}</p> : c.quoteNote ? <p className="sk-note">{c.quoteNote}</p> : null}
    {c.flags.map(f => <p className="sk-flag" key={f.flag}><Icon name="alert" size={14} />{f.label}</p>)}
    <button type="button" className="sk-view" aria-pressed={selected} onClick={onView}>
      {selected ? tr("Showing this passage") : tr("View passage")}
    </button>
  </article></li>;
}

function NoSource({ a, onEdit }: { a: AskAnswer; onEdit?: () => void }) {
  return <section className="sk-empty" aria-label={tr("No supporting source found")}>
    <h2>{tr("No supporting source found")}</h2>
    <p>{tr("Sprink searched the reference library but could not find enough supporting material to answer reliably. Sprink does not guess without a source.")}</p>
    {a.summary && <p className="sk-muted">{a.summary}</p>}
    <ul>
      <li>{tr("Use the words printed in the code or on the product, such as a section number or model number.")}</li>
      <li>{tr("Ask one thing at a time.")}</li>
      <li>{tr("Check the list of references. The document or edition you need may not be in the library yet.")}</li>
    </ul>
    {onEdit && <Button variant="primary" onClick={onEdit}>{tr("Edit question")}</Button>}
  </section>;
}

function OriginalPage({ citation: c, onBack }: { citation: Citation; onBack: () => void }) {
  const image = useAuthedUrl(c.page?.image);
  const [context, setContext] = useState(false);
  const [full, setFull] = useState(false);
  const [zoom, setZoom] = useState(false);
  const dialog = useRef<HTMLDialogElement>(null);
  useEffect(() => { if (full) dialog.current?.showModal?.(); else dialog.current?.close?.(); }, [full]);
  const original = c.original && /^https?:/.test(c.original) ? `${c.original.split("#")[0]}${c.pageStart ? `#page=${c.pageStart}` : ""}` : null;
  const crop = c.excerpt && (context ? c.excerpt.contextBox : c.excerpt.box);
  const ratio = crop && c.excerpt ? (crop.w * c.excerpt.pageWidth) / (crop.h * c.excerpt.pageHeight) : 1;
  const displayWidth = crop && c.excerpt ? Math.max((crop.w * c.excerpt.pageWidth) / (c.excerpt.box.h * c.excerpt.pageHeight) * 340, Math.min(620, crop.w * c.excerpt.pageWidth)) : 0;
  const pageNo = c.page?.number ?? c.pageStart;
  const alt = `${c.docTitle} — ${tr("original page {page}", { page: pageNo ?? "?" })}`;
  const p = pages(c);
  return <article className="sk-original" aria-label={tr("Source passage")}>
    <header className="sk-original-head">
      <div className="sk-original-title"><strong>{c.excerpt?.label ?? (c.sectionId || c.heading)}</strong><small>{[c.docTitle, c.edition, p].filter(Boolean).join(" · ")}</small></div>
      <div className="sk-original-tools">
        {c.excerpt && image.url && <button type="button" aria-pressed={context} onClick={() => setContext(!context)}>{context ? tr("Focus on match") : tr("Show context")}</button>}
        {c.page && image.url && <button type="button" onClick={() => setFull(true)}>{tr("Full page")}</button>}
        <button type="button" className="sk-back" onClick={onBack}>{tr("Back to sources")}</button>
      </div>
    </header>
    {c.page ? image.error ? <div className="sk-original-msg"><Callout tone="amber" title={tr("Could not load the page image")}>{original ? tr("Open the original document instead, or read the indexed text below.") : tr("Read the indexed text below, or try again later.")}</Callout></div>
      : image.url ? crop ?
        <div className="sk-crop-stage"><div className="sk-crop" style={{ aspectRatio: ratio, maxWidth: `${displayWidth}px` }}>
          <img src={image.url} alt={`${alt} — ${c.excerpt!.label}${context ? ` (${tr("with surrounding context")})` : ""}`} style={{ width: `${100 / crop.w}%`, left: `${-crop.x / crop.w * 100}%`, top: `${-crop.y / crop.h * 100}%` }} />
        </div></div>
        : <div className="sk-page"><img src={image.url} alt={alt} /></div>
      : <Spinner label={tr("Loading page…")} />
      : <p className="sk-original-msg sk-muted">{tr("No page image is available for this source. Read the indexed text below or open the original.")}</p>}
    <footer className="sk-original-foot">
      <span>{c.page && !image.error ? c.excerpt ? tr("Cropped from the original · wording and diagrams unchanged") : tr("Full page shown · no reviewed excerpt available") : c.typeLabel}</span>
      {original && <a href={original} target="_blank" rel="noreferrer">{tr("Open original")} <Icon name="external" size={14} /></a>}
    </footer>
    <details className="sk-text" open={!c.page || image.error || undefined}>
      <summary>{tr("Indexed text")}</summary>
      {c.flags.map(f => <p className="sk-flag" key={f.flag}><Icon name="alert" size={14} />{f.label}</p>)}
      {c.quote && <blockquote>{c.quote}</blockquote>}
      {c.quoteNote && <small>{c.quoteNote}</small>}
    </details>
    <dialog ref={dialog} className="sk-dialog" aria-label={`${tr("Full page")} · ${c.docTitle}`} onClose={() => { setFull(false); setZoom(false); }}>
      <header><div><strong>{c.docTitle}</strong><small>{[c.edition, p].filter(Boolean).join(" · ")}</small></div>
        <div><button type="button" onClick={() => setZoom(!zoom)}>{zoom ? tr("Fit page") : tr("Zoom in")}</button><button type="button" className="is-primary" autoFocus onClick={() => setFull(false)}>{tr("Close")}</button></div></header>
      <div className="sk-dialog-body">{image.url && <img className={zoom ? "is-zoomed" : ""} src={image.url} alt={alt} />}</div>
    </dialog>
  </article>;
}
