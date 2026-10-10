import { ApiError, session } from "../api.js";

/** Mirrors apps/server/src/sources (ask.ts, types.ts). The server is the only source of these values. */
export type Origin = "project" | "sample" | "you" | "derived" | "catalog" | "document" | "photo";
export interface ContextFact { name: string; label: string; value: string | number | null; unit: string | null; origin: Origin; detail: string }
export interface FollowUp { id: string; question: string; kind: "choice" | "measurement"; field: string; options?: Array<{ value: string; label: string }>; unit?: string }
export interface Citation {
  key: string; docId: string; docTitle: string; publisher: string; type: string; typeLabel: string; edition: string;
  sectionId: string; heading: string; kind: string; label: string; role: string; via?: string;
  pageStart: number | null; pageEnd: number | null; demonstration: boolean;
  flags: Array<{ flag: string; label: string }>;
  quote: string | null; quoteNote: string | null; table: string[][] | null;
  notes: Array<{ text: string; author: string }>;
  link: string; original: string | null;
  revision: { uploadId: string; revision: number; basis: "extracted" | "corrected"; label: string } | null;
  excerpt?: { id: string; label: string; box: PdfBox; contextBox: PdfBox; pageWidth: number; pageHeight: number };
  page: { image: string; number: number } | null;
  regions: Region[];
}
export interface PdfBox { x: number; y: number; w: number; h: number }
export interface Region { page: number; x: number; y: number; w: number; h: number }
export interface Claim { id: string; text: string; citations: string[]; kind: "note" | "pointer" | "quote"; status: "supported" | "unresolved"; reason?: string }
export interface AttachmentView {
  id: string; filename: string; kindLabel: string; preview: string; note: string;
  observations: Array<{ id: string; kind: "text" | "marking" | "dimension_text"; text: string; confidence: number; page: number; status: "read" | "unclear" | "confirmed" | "rejected" }>;
}
export interface ConditionCheck { question: string; name: string; value: number | null; unit: string; origin: Origin | null; detail: string | null; op: string; limit: number; result: "met" | "not_met" | "unknown" }
export interface ExceptionStatus { key: string; sectionId: string; parentSectionId: string; status: "applies" | "does_not_apply" | "unknown"; checks: ConditionCheck[]; note: string }
export interface AskAnswer {
  id: string; question: string; askedAt: string;
  context: {
    projectId: string | null; packageTitle: string | null; standard: string | null;
    edition: { value: string | null; status: "resolved" | "answered" | "unknown"; reason: string; script?: string };
    jurisdiction: string | null; selectedElementId: string | null;
    siteCondition: { id: string; description: string } | null;
    facts: ContextFact[];
  };
  status: "answered" | "needs_input" | "no_source";
  summary: string;
  explanation: Claim[]; unresolved: Claim[]; exceptions: ExceptionStatus[];
  missing: string[]; followUps: FollowUp[]; sources: Citation[];
  conflicts: Array<{ topic: string; resolution: string; items: Array<{ key: string; position: string; label: string }> }>;
  excluded: Array<{ docId: string; title: string; edition: string; reason: string }>;
  attachments: AttachmentView[];
  timings: { retrievalMs: number; compositionMs: number; modelMs: number; totalMs: number };
}
export interface SourceDocument {
  id: string; title: string; publisher: string; type: string; edition: string; demonstration: boolean;
  scope: Record<string, unknown>; url?: string; importedAt: string; sectionCount: number; flags: string[];
  authorization: { basis: string; display: string; maxQuoteChars?: number };
  upload?: { uploadId: string; revision: number; basis: "extracted" | "corrected"; pageCount: number };
}
export interface SectionView {
  key: string; docId: string; sectionId: string; heading: string; kind: string; parentKey: string | null;
  pageStart: number | null; pageEnd: number | null; text: string; table: string[][] | null; flags: string[];
  limited: string | null; notes?: Array<{ text: string; author: string }>; regions?: Region[];
}

async function call<T>(path: string, init: RequestInit = {}): Promise<T> {
  const res = await fetch(path, { ...init, headers: { Authorization: `Bearer ${session.token()}`, ...(init.body ? { "Content-Type": "application/json" } : {}), ...init.headers } });
  if (!res.ok) {
    let code = String(res.status), message = `Request failed (${res.status})`;
    try { const b = await res.json(); if (typeof b.code === "string") code = b.code; if (typeof b.error === "string") message = b.error; } catch { /* keep status */ }
    throw new ApiError(res.status, code, message);
  }
  return res.json() as Promise<T>;
}

/** Fetches an authenticated file (page image, preview, original) as an object URL. */
export async function authedBlobUrl(href: string): Promise<string> {
  const res = await fetch(href, { headers: { Authorization: `Bearer ${session.token()}` } });
  if (!res.ok) throw new ApiError(res.status, String(res.status), "Could not load the file");
  return URL.createObjectURL(await res.blob());
}

export const askApi = {
  search: (question: string, signal?: AbortSignal) => call<AskAnswer>("/api/rules/search", { method: "POST", body: JSON.stringify({ question }), signal }),
  documents: () => call<{ documents: SourceDocument[] }>("/api/sources"),
  passage: (link: string) => call<{ document: SourceDocument; target: string; sections: SectionView[] }>(link),
  async original(href: string): Promise<string> {
    const res = await fetch(href, { headers: { Authorization: `Bearer ${session.token()}` } });
    if (!res.ok) throw new ApiError(res.status, String(res.status), "Could not open the original file");
    return res.text();
  },
};
