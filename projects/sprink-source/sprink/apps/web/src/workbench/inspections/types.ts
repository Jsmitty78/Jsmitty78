export type { TaskSnapshot, Observation, EvidenceRequest, Candidate, ValidationReport, Artifact } from "../../../../server/src/models.js";
import type { TaskSnapshot } from "../../../../server/src/models.js";
export type TaskSummary = Pick<TaskSnapshot, "id" | "title" | "state" | "revision" | "updatedAt">;
export type Action = (label: string, work: () => Promise<unknown>, after?: () => void) => Promise<boolean>;
