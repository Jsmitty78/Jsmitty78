// @vitest-environment happy-dom
import { act, createElement as h } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { setLocale } from "../locale.js";
import { AskPanel, appendTranscript } from "./AskPanel.js";
import type { AskAnswer, Citation } from "./askApi.js";
import type { RecognitionLike } from "./speech.js";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

/** Browser speech API stand-in. Tests drive it; nothing touches a microphone. */
class FakeRecognition implements RecognitionLike {
  static all: FakeRecognition[] = [];
  lang = ""; continuous = true; interimResults = false; maxAlternatives = 1;
  onstart: RecognitionLike["onstart"] = null; onaudiostart: RecognitionLike["onaudiostart"] = null;
  onresult: RecognitionLike["onresult"] = null; onerror: RecognitionLike["onerror"] = null; onend: RecognitionLike["onend"] = null;
  aborted = false;
  constructor() { FakeRecognition.all.push(this); }
  start() {}
  stop() { this.onend?.(new Event("end")); }
  abort() { this.aborted = true; }
  say(text: string, isFinal = true) { this.onresult?.({ results: [Object.assign([{ transcript: text }], { isFinal })] }); }
}
const lastRec = () => FakeRecognition.all.at(-1)!;

function citation(over: Partial<Citation> = {}): Citation {
  return {
    key: "k1", docId: "nfpa13", docTitle: "NFPA 13: Standard for the Installation of Sprinkler Systems", publisher: "NFPA", type: "code", typeLabel: "Code / standard",
    edition: "2022 edition", sectionId: "10.2.6.1.1", heading: "Distance below ceilings", kind: "requirement", label: "Requirement text", role: "main",
    pageStart: 112, pageEnd: 112, demonstration: false, flags: [], quote: "The deflector shall be a minimum of 1 in. below the ceiling.", quoteNote: null, table: null,
    notes: [], link: "/api/sources/nfpa13/sections/k1", original: null, revision: null, page: null, regions: [], ...over,
  };
}
function answer(over: Partial<AskAnswer> = {}): AskAnswer {
  return {
    id: "a1", question: "q", askedAt: "", status: "answered", summary: "1 matching passage from 1 document in the shared library.",
    context: { projectId: null, packageTitle: null, standard: null, edition: { value: null, status: "unknown", reason: "Reference search does not determine the edition adopted for a project." }, jurisdiction: null, selectedElementId: null, siteCondition: null, facts: [] },
    explanation: [], unresolved: [], exceptions: [], missing: [], followUps: [], sources: [citation()], conflicts: [], excluded: [], attachments: [],
    timings: { retrievalMs: 10, compositionMs: 0, modelMs: 0, totalMs: 10 }, ...over,
  };
}

const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });
let searches: Array<{ question: string; resolve: (r: Response) => void; reject: (e: unknown) => void; signal?: AbortSignal }>;
let root: Root, host: HTMLElement;

beforeEach(() => {
  setLocale("en");
  sessionStorage.clear();
  searches = [];
  FakeRecognition.all = [];
  vi.stubGlobal("fetch", vi.fn((url: string, init?: RequestInit) => {
    if (url === "/api/sources") return Promise.resolve(json({ documents: [] }));
    if (url === "/api/rules/search") return new Promise<Response>((resolve, reject) => searches.push({ question: JSON.parse(String(init?.body)).question, resolve, reject, signal: init?.signal ?? undefined }));
    return Promise.reject(new Error(`unexpected ${url}`));
  }));
  host = document.createElement("div");
  document.body.appendChild(host);
});
afterEach(async () => {
  await act(async () => root?.unmount());
  host.remove();
  vi.unstubAllGlobals();
  delete (window as { webkitSpeechRecognition?: unknown }).webkitSpeechRecognition;
});

async function mount(speech: boolean) {
  if (speech) (window as { webkitSpeechRecognition?: unknown }).webkitSpeechRecognition = FakeRecognition;
  root = createRoot(host);
  await act(async () => root.render(h(AskPanel, { embedded: true, onClose() {} })));
}
const q = <T extends Element = HTMLElement>(sel: string) => host.querySelector<T>(sel)!;
const box = () => q<HTMLTextAreaElement>("#ask-q");
const askButton = () => q<HTMLButtonElement>(".sk-submit");
const mic = () => q<HTMLButtonElement>(".sk-mic");
const text = () => host.textContent ?? "";
async function type(value: string) {
  await act(async () => {
    Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, "value")!.set!.call(box(), value);
    box().dispatchEvent(new Event("input", { bubbles: true }));
  });
}
async function click(el: HTMLElement) { await act(async () => { el.click(); }); }
async function respond(res: Response, i = searches.length - 1) { await act(async () => { searches[i].resolve(res); await Promise.resolve(); }); await act(async () => {}); }

describe("typed questions", () => {
  it("disables Ask until there is a question, and Enter on an empty box sends nothing", async () => {
    await mount(false);
    expect(askButton().disabled).toBe(true);
    await type("   ");
    expect(askButton().disabled).toBe(true);
    await act(async () => { box().dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", bubbles: true })); });
    expect(searches).toHaveLength(0);
  });

  it("submits the typed question once, shows progress, and blocks duplicate submits", async () => {
    await mount(false);
    await type("Max hanger spacing for 1 inch steel pipe?");
    await act(async () => { askButton().click(); askButton().click(); q<HTMLFormElement>("form").requestSubmit(); });
    expect(searches.map(s => s.question)).toEqual(["Max hanger spacing for 1 inch steel pipe?"]);
    expect(askButton().disabled).toBe(true);
    expect(askButton().getAttribute("aria-busy")).toBe("true");
    expect(text()).toContain("Searching the reference library");
    expect(q(".sk-asked").textContent).toContain("Max hanger spacing for 1 inch steel pipe?");
    expect(box().value).toBe("Max hanger spacing for 1 inch steel pipe?");
  });

  it("shows the answer first, then each source with edition, section and page", async () => {
    await mount(false);
    await type("deflector distance");
    await click(askButton());
    await respond(json(answer()));
    const answerBlock = q(".sk-answer");
    expect(answerBlock.textContent).toContain("1 matching passage");
    expect(answerBlock.textContent).toContain("does not determine the edition");
    const card = q(".sk-source");
    expect(card.textContent).toContain("NFPA 13: Standard for the Installation of Sprinkler Systems");
    expect(card.textContent).toContain("2022 edition");
    expect(card.textContent).toContain("10.2.6.1.1 · Distance below ceilings");
    expect(card.textContent).toContain("p. 112");
    expect(answerBlock.compareDocumentPosition(card) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(askButton().disabled).toBe(false);
  });

  it("shows conflicting sources instead of hiding them", async () => {
    await mount(false);
    await type("deflector distance");
    await click(askButton());
    await respond(json(answer({ conflicts: [{ topic: "Distance below ceiling", resolution: "Check the adopted edition.", items: [{ key: "k1", position: "1 in. minimum", label: "NFPA 13" }, { key: "k2", position: "12 in. maximum", label: "TFP151" }] }] })));
    expect(q(".sk-conflicts").textContent).toContain("Sources disagree");
    expect(q(".sk-conflicts").textContent).toContain("12 in. maximum");
  });

  it("treats no supporting source as a result, not an error, and offers to edit", async () => {
    await mount(false);
    await type("something not in the library");
    await click(askButton());
    await respond(json(answer({ status: "no_source", sources: [], summary: "No supporting passage was found in the shared library." })));
    expect(q(".sk-empty").textContent).toContain("No supporting source found");
    expect(q(".sk-empty").textContent).toContain("could not find enough supporting material");
    expect(host.querySelector("[role=alert]")).toBeNull();
    expect(host.querySelector(".sk-source")).toBeNull();
    expect(box().value).toBe("something not in the library");
  });

  it("keeps the question and offers a retry when the search service fails", async () => {
    await mount(false);
    await type("riser clearance");
    await click(askButton());
    await respond(json({ error: "Source search is unavailable. Please try again.", code: "source_search_transport_failed" }, 503));
    expect(q("[role=alert]").textContent).toContain("Reference search is unavailable");
    expect(box().value).toBe("riser clearance");
    const retry = [...host.querySelectorAll("button")].find(b => b.textContent === "Try again")!;
    await click(retry);
    expect(searches.map(s => s.question)).toEqual(["riser clearance", "riser clearance"]);
  });

  it("does not show raw server failure text", async () => {
    await mount(false);
    await type("riser clearance");
    await click(askButton());
    await respond(json({ error: "TypeError: cannot read properties of undefined at ask.ts:412", code: "internal_error" }, 500));
    expect(text()).not.toContain("ask.ts");
    expect(text()).toContain("Something went wrong on the server");
  });

  it("lays out very long titles and section numbers without dropping them", async () => {
    await mount(false);
    await type("long");
    await click(askButton());
    const title = `NFPA 13 ${"Installation Requirements for Standard Pendent Spray Sprinklers ".repeat(6)}`;
    const section = "A.10.2.6.1.1.1.2_https://example.com/a/very/long/unbroken/identifier/that/must/wrap";
    await respond(json(answer({ sources: [citation({ docTitle: title, sectionId: section, pageStart: 3, pageEnd: 5 })] })));
    expect(q(".sk-source h3").textContent).toBe(title);
    expect(q(".sk-source").textContent).toContain(section);
    expect(q(".sk-source").textContent).toContain("pp. 3–5");
  });
});

describe("voice question entry", () => {
  it("falls back to typing when the browser has no speech recognition", async () => {
    await mount(false);
    expect(mic().getAttribute("aria-label")).toBe("Voice entry unavailable");
    await click(mic());
    expect(q("#ask-voice-status").textContent).toContain("isn't available in this browser");
    await type("typed instead");
    expect(askButton().disabled).toBe(false);
  });

  it("puts the transcript in the question box without asking, then sends the edited text", async () => {
    await mount(true);
    await click(mic());
    expect(q("#ask-voice-status").textContent).toContain("Starting the microphone");
    await act(async () => lastRec().onstart?.(new Event("start")));
    expect(q("#ask-voice-status").textContent).toContain("Listening");
    expect(mic().getAttribute("aria-label")).toBe("Stop listening");
    expect(askButton().disabled).toBe(true);
    await act(async () => lastRec().say("does NFPA 13 are allow CPVC", false));
    expect(q(".sk-heard").textContent).toBe("does NFPA 13 are allow CPVC");
    await act(async () => lastRec().say("does NFPA 13 are allow CPVC"));
    await click(mic());
    expect(box().value).toBe("does NFPA 13 are allow CPVC");
    expect(text()).toContain("Check technical terms and measurements before asking");
    expect(searches).toHaveLength(0);
    await type("Does NFPA 13R allow CPVC?");
    await click(askButton());
    expect(searches.map(s => s.question)).toEqual(["Does NFPA 13R allow CPVC?"]);
  });

  it("adds voice text after what was already typed, and Undo restores it", async () => {
    await mount(true);
    await type("For a 1-1/2 inch branch line,");
    await click(mic());
    await act(async () => { lastRec().onstart?.(new Event("start")); lastRec().say("what is the max hanger spacing"); lastRec().onend?.(new Event("end")); });
    expect(box().value).toBe("For a 1-1/2 inch branch line, what is the max hanger spacing");
    await click(mic());
    await act(async () => { lastRec().onstart?.(new Event("start")); lastRec().say("schedule 40"); lastRec().onend?.(new Event("end")); });
    expect(box().value).toBe("For a 1-1/2 inch branch line, what is the max hanger spacing schedule 40");
    const undo = [...host.querySelectorAll("button")].find(b => b.textContent === "Undo")!;
    await click(undo);
    expect(box().value).toBe("For a 1-1/2 inch branch line, what is the max hanger spacing");
    expect(searches).toHaveLength(0);
  });

  it("Cancel adds nothing and leaves the typed question alone", async () => {
    await mount(true);
    await type("existing text");
    await click(mic());
    await act(async () => { lastRec().onstart?.(new Event("start")); lastRec().say("half a sentence", false); });
    const cancel = [...q("#ask-voice-status").querySelectorAll("button")].find(b => b.textContent === "Cancel")!;
    await click(cancel);
    expect(lastRec().aborted).toBe(true);
    expect(box().value).toBe("existing text");
    expect(q("#ask-voice-status").textContent).toContain("Nothing was added");
    expect(askButton().disabled).toBe(false);
  });

  it("explains blocked microphone permission and recognition failures", async () => {
    await mount(true);
    await click(mic());
    await act(async () => { lastRec().onerror?.({ error: "not-allowed" }); lastRec().onend?.(new Event("end")); });
    expect(q("#ask-voice-status").textContent).toContain("Microphone access is blocked");
    await click(mic());
    await act(async () => { lastRec().onstart?.(new Event("start")); lastRec().onerror?.({ error: "audio-capture" }); lastRec().onend?.(new Event("end")); });
    expect(q("#ask-voice-status").textContent).toContain("stopped unexpectedly");
    await click(mic());
    await act(async () => { lastRec().onstart?.(new Event("start")); lastRec().onerror?.({ error: "no-speech" }); lastRec().onend?.(new Event("end")); });
    expect(q("#ask-voice-status").textContent).toContain("No speech was heard");
    expect(box().value).toBe("");
    expect(searches).toHaveLength(0);
  });

  it("stops listening when the panel goes away", async () => {
    await mount(true);
    await click(mic());
    await act(async () => lastRec().onstart?.(new Event("start")));
    const rec = lastRec();
    await act(async () => root.unmount());
    expect(rec.aborted).toBe(true);
    root = createRoot(host);
  });
});

describe("transcript insertion", () => {
  it("appends after existing text with a single space", () => {
    expect(appendTranscript("", "riser")).toBe("riser");
    expect(appendTranscript("What about  ", " the riser ")).toBe("What about the riser");
    expect(appendTranscript("Keep me", "   ")).toBe("Keep me");
  });
});
