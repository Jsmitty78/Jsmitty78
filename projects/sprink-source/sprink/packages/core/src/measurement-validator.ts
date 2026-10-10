import { contextIssues, evidenceIssues } from "./evidence.js";
import type { Measurement, MeasurementEndpoint, MeasurementValidation, RuleContext } from "./types.js";

function endpointIssues(point: MeasurementEndpoint, method: "ar_raycast" | "fixture", ctx: RuleContext, name: string): string[] {
  const issues = evidenceIssues(point.evidenceIds, ctx, name);
  if (!point.coordinateFrameId.trim()) issues.push(`${name}.coordinateFrameId`);
  if (!point.captureSessionId.trim()) issues.push(`${name}.captureSessionId`);
  if (!Number.isFinite(point.timestamp) || point.timestamp < 0) issues.push(`${name}.timestamp`);
  if (point.position.length !== 3 || point.position.some(value => !Number.isFinite(value))) issues.push(`${name}.position`);
  if (point.tracking !== "normal") issues.push(`${name}.tracking`);
  const permittedHits = method === "ar_raycast" ? ["existing_plane", "estimated_plane"] : ["fixture"];
  if (!permittedHits.includes(point.hit)) issues.push(`${name}.hit`);
  if (method === "ar_raycast") {
    const sameFrame = point.evidenceIds.some(id => {
      const image = ctx.observations.find(e => e.id === id && e.targetId === ctx.targetId && !e.superseded && !e.invalidated);
      return image?.spatial?.captureSessionId === point.captureSessionId
        && image.spatial.coordinateFrameId === point.coordinateFrameId
        && image.spatial.timestamp === point.timestamp
        && image.spatial.tracking === point.tracking;
    });
    if (!sameFrame) issues.push(`${name}.imageFrameAssociation`);
  }
  return issues;
}

export function validateMeasurement(measurement: Measurement, ctx: RuleContext): MeasurementValidation {
  const issues = [...contextIssues(ctx), ...evidenceIssues(measurement.evidenceIds, ctx, "measurement")];
  if (measurement.targetId !== ctx.targetId) issues.push("measurement.targetId");
  if (!measurement.id.trim()) issues.push("measurement.id");
  if (measurement.unit !== "m") issues.push("measurement.unit");
  let valueMeters: number | null = null;

  if (measurement.method === "manual") {
    if (!Number.isFinite(measurement.valueMeters) || measurement.valueMeters < 0) issues.push("measurement.valueMeters");
    if (!measurement.fromLabel.trim()) issues.push("measurement.fromLabel");
    if (!measurement.toLabel.trim()) issues.push("measurement.toLabel");
    valueMeters = measurement.valueMeters;
  } else {
    issues.push(...endpointIssues(measurement.from, measurement.method, ctx, "from"));
    issues.push(...endpointIssues(measurement.to, measurement.method, ctx, "to"));
    if (measurement.from.coordinateFrameId !== measurement.to.coordinateFrameId) issues.push("coordinateFrameId");
    if (measurement.from.captureSessionId !== measurement.to.captureSessionId) issues.push("captureSessionId");
    if (measurement.to.timestamp < measurement.from.timestamp) issues.push("timestampOrder");
    valueMeters = Math.hypot(...measurement.to.position.map((value, i) => value - measurement.from.position[i]));
    if (!Number.isFinite(valueMeters)) issues.push("measurement.valueMeters");
  }

  const qualityRecorded = issues.length === 0;
  return {
    measurementId: measurement.id,
    status: qualityRecorded ? "recorded" : "unknown",
    qualityRecorded,
    accuracy: "unknown",
    valueMeters: qualityRecorded ? valueMeters : null,
    reason: qualityRecorded
      ? "Measurement inputs and acquisition quality were recorded. Physical accuracy and correct physical point selection remain unverified."
      : "The measurement lacks valid, consistently referenced acquisition data.",
    missingInputs: [...new Set(issues)],
    targetId: ctx.targetId,
    taskRevision: ctx.taskRevision,
  };
}
