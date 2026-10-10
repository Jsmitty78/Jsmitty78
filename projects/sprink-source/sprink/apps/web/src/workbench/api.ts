import type {
  PackageInputs,
  PackageIntent,
  StartPackageRun,
  WorkPackageSnapshot,
} from "@sprink/core";

/** Server snapshot plus read-time freshness (apps/server/src/work-packages/service.ts). */
export interface Freshness {
  candidates: boolean;
  results: Array<{ id: string; current: boolean }>;
  requests: Array<{ id: string; current: boolean; answered: boolean }>;
  artifacts: Array<{ id: string; current: boolean }>;
}
export type Snapshot = WorkPackageSnapshot & { title: string; freshness: Freshness };
export type Summary = Pick<Snapshot, "id" | "projectId" | "title" | "intent" | "inputRevision" | "updatedAt"> & Partial<Snapshot>;

export class ApiError extends Error {
  constructor(public status: number, public code: string, message: string) { super(message); }
}

const TOKEN_KEY = "sprink.token";
export const session = {
  token: (): string => { try { return sessionStorage.getItem(TOKEN_KEY) ?? ""; } catch { return ""; } },
  setToken(token: string) { try { sessionStorage.setItem(TOKEN_KEY, token); } catch { /* private mode: keep in memory only */ } },
  clear() { try { sessionStorage.removeItem(TOKEN_KEY); } catch { /* ignore */ } },
};

const MESSAGES: Record<string, string> = {
  revision_conflict: "Someone or something changed this package since you loaded it. Reload to see the latest inputs.",
  stale_candidates: "These alternatives were generated for older inputs. Regenerate before selecting.",
  confirmed_baseline_is_immutable: "The confirmed baseline and drawing are frozen in this package. Start a new package for a new drawing revision.",
  approved_source_is_immutable: "The approved source drawing is frozen in this package.",
  selected_plan_baseline_conflict: "A plan is selected. Clear the selection before changing the baseline run.",
  runner_unavailable: "The work-package runner is not configured on this server.",
  run_no_longer_current: "That run is no longer current.",
};

async function call(path: string, init: RequestInit = {}): Promise<Response> {
  const response = await fetch(`/api/work-packages${path}`, {
    ...init,
    headers: { Authorization: `Bearer ${session.token()}`, ...(init.body && !(init.body instanceof FormData) ? { "Content-Type": "application/json" } : {}), ...init.headers },
  });
  if (!response.ok) {
    let code = String(response.status), message = `Request failed (${response.status})`;
    try {
      const body = await response.json();
      if (typeof body.code === "string") code = body.code;
      if (typeof body.error === "string") message = body.error;
    } catch { /* non-JSON proxy error: keep the status */ }
    if (response.status === 401) message = "The access token was not accepted. Check it and connect again.";
    throw new ApiError(response.status, code, MESSAGES[code] ?? message);
  }
  return response;
}
const json = async <T>(path: string, init?: RequestInit) => (await call(path, init)).json() as Promise<T>;
const post = <T>(path: string, body: unknown) => json<T>(path, { method: "POST", body: JSON.stringify(body) });

export const api = {
  siteEvidence: (id: string, body: unknown) => post<Snapshot>(`/${encodeURIComponent(id)}/site-evidence`, body),
  readingRequest: (id: string, body: unknown) => post<Snapshot>(`/${encodeURIComponent(id)}/reading-request`, body),
  confirmReading: (id: string, body: unknown) => post<Snapshot>(`/${encodeURIComponent(id)}/reading-confirmation`, body),
  measurement: (id: string, body: unknown) => post<Snapshot>(`/${encodeURIComponent(id)}/measurements`, body),
  designerReview: (id: string, body: unknown) => post<Snapshot>(`/${encodeURIComponent(id)}/designer-reviews`, body),
  siteWork: (id: string) => json<{fingerprint: string}>(`/${encodeURIComponent(id)}/site-work`),
  list: (projectId: string) => json<Summary[]>(`?projectId=${encodeURIComponent(projectId)}`),
  create: (projectId: string, intent: PackageIntent, title: string) => post<Snapshot>("", { projectId, intent, title }),
  copySiteChange: (id: string, expectedRevision: number, title: string) => post<Snapshot>(`/${encodeURIComponent(id)}/site-change`, { expectedRevision, title }),
  get: (id: string, signal?: AbortSignal) => json<Snapshot>(`/${encodeURIComponent(id)}`, { signal }),
  /** Integrated server only; returns null when the detail route is not mounted. */
  async detail(id: string, signal?: AbortSignal): Promise<Detail | null> {
    try { return await json<Detail>(`/${encodeURIComponent(id)}/detail`, { signal }); }
    catch (error) { if (error instanceof ApiError && error.status === 404) return null; throw error; }
  },
  edit: (id: string, expectedRevision: number, patch: Partial<PackageInputs>) =>
    json<Snapshot>(`/${encodeURIComponent(id)}`, { method: "PATCH", body: JSON.stringify({ expectedRevision, patch }) }),
  select: (id: string, expectedRevision: number, planId: string) => post<Snapshot>(`/${encodeURIComponent(id)}/selection`, { expectedRevision, planId }),
  start: (id: string, expectedRevision: number, goal: StartPackageRun["goal"]) => post<unknown>(`/${encodeURIComponent(id)}/runs`, { expectedRevision, goal }),
  cancel: (id: string, runId: string) => post<unknown>(`/${encodeURIComponent(id)}/runs/${encodeURIComponent(runId)}/cancel`, {}),
  answer: (id: string, expectedRevision: number, requestId: string, value: string | null, unavailableReason: string | null) =>
    post<Snapshot>(`/${encodeURIComponent(id)}/answers`, { expectedRevision, requestId, value, unavailableReason }),
  async upload(id: string, file: File): Promise<{ id: string; filename: string; mimeType: string }> {
    const body = new FormData();
    body.set("file", file);
    return (await call(`/${encodeURIComponent(id)}/assets`, { method: "POST", body })).json();
  },
  asset: async (id: string, assetId: string) => (await call(`/${encodeURIComponent(id)}/assets/${encodeURIComponent(assetId)}`)).blob(),
  artifact: async (id: string, artifactId: string) => (await call(`/${encodeURIComponent(id)}/artifacts/${encodeURIComponent(artifactId)}/download`)).blob(),
};

/**
 * The subset of `GET /:id/detail` (apps/server/src/integration/runtime.ts) the UI reads.
 * Everything is optional: the UI must still work from the snapshot contract alone.
 */
export interface DetailMetric { value: number | null; unit: string; basis?: string; reasons?: string[] }
export interface DetailCut {
  pieceId: string; callout: number; sourceSegmentIds: string[];
  centerline: DetailMetric; cutLength: DetailMetric;
  takeouts: Array<{ nodeId: string; datum: string; fittingId: string | null; portId: string | null; netTakeout: DetailMetric; sourceIds: string[] }>;
  formula?: string;
}
export interface DetailFitting { id: string; callout: string; productId: string; nodeId: string; position?: { value: { x: number; y: number; z: number } | null } }
export interface DetailJoint { id: string; callout: number; pieceId: string; fittingId: string | null; portId: string | null; orientation?: string }
export interface DetailDelta {
  materials: Array<{ id: string; baselineQuantity: number | null; candidateQuantity: number | null; quantityDelta: number | null; centerlineDeltaM: number | null; cutLengthDeltaM: number | null }>;
  pieces: Array<{ pieceId: string; state: string; proposedReuse: boolean; cutLengthDeltaM: number | null }>;
  centerlineDeltaM: number | null; cutLengthDeltaM: number | null; jointCountDelta: number | null; operationCountDelta: number | null;
}
export interface DetailPlan {
  id: string;
  plan: { id: string };
  input?: { planRole?: string };
  fabrication?: {
    cuts: DetailCut[]; fittings: DetailFitting[]; joints: DetailJoint[];
    selectedProducts?: Array<{ id: string; label: string; nominalSize?: string }>;
    sources?: Array<{ id: string; title?: string; url?: string; revision?: string }>;
    rounding?: string;
  };
  delta?: DetailDelta;
}
export interface Detail { state: { inputRevision: number; details: DetailPlan[]; latestRun?: { id: string; explanation?: string; status: string; question?: { text: string; kind: "fact" | "candidate_selection" } } } | null; current?: boolean }
