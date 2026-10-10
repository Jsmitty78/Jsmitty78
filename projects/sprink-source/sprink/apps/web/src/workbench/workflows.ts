import type { PackageResult } from "@sprink/core";
import { api, type Snapshot } from "./api.js";
import { getLocale, type Locale } from "./locale.js";
import type { Plan } from "./model.js";
export const WORKFLOWS = [["materials", "材料・組立"], ["site", "現場変更"], ["codes", "コード検索"]] as const;
export type Workflow = typeof WORKFLOWS[number][0];
export function materialSelection(result: PackageResult | undefined, group: string | null, piece: string | null): string[] {
  return group ? [...new Set(result?.materials.find(m => m.id === group)?.entityIds ?? [])] : piece ? [piece] : [];
}
export function sourcePlanForDisplay(siteWorkflow: boolean, candidatesCurrent: boolean, selectedResultCurrent: boolean, baseline: Plan | null, proposal: Plan | null): Plan | null {
  return siteWorkflow && !candidatesCurrent && !selectedResultCurrent ? baseline : proposal;
}

export function copyForSiteChange(s: Pick<Snapshot, "id" | "title" | "inputRevision">, locale: Locale = getLocale()) {
  return api.copySiteChange(s.id, s.inputRevision, `${s.title} — ${locale === "en" ? "Site change" : "現場変更"}`);
}
