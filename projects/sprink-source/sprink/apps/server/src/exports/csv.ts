import type { ExportSnapshot } from './types.js';
import { unresolved } from './snapshot.js';

/** Quote every field. Prefix formula/control-leading text before RFC 4180 quoting. */
export function csvCell(value: string | number | null): string {
  let text = value === null ? '' : String(value);
  if (typeof value === 'string' && (/^[\s\u0000-\u001f\uFEFF]*[=+@-]/u.test(text) || /^[\t\r\n]/u.test(text))) text = "'" + text;
  return '"' + text.replaceAll('"', '""') + '"';
}
const table = (rows: (string | number | null)[][]): Buffer => Buffer.from('\uFEFF' + rows.map(row => row.map(csvCell).join(',')).join('\r\n') + '\r\n', 'utf8');
export function csvFiles(s: ExportSnapshot): { bom: Buffer; cuts: Buffer } {
  const metadata = [s.binding.packageId, s.binding.inputRevision, s.binding.configVersion, s.binding.selectionId, s.binding.outputVersion, '', 'not_established_by_export', s.drawingReference, '', ''];
  const headings = ['package_id', 'input_revision', 'config_version', 'selected_plan_id', 'output_version', 'package_unresolved_items', 'approval_status', 'drawing_reference', 'input_facts', 'protected_context_not_for_purchase'];
  // Package-wide documents occur once per file, never once per output row.
  const packageMetadata = [...metadata];
  packageMetadata[5] = JSON.stringify(unresolved(s));
  packageMetadata[8] = JSON.stringify(s.inputFacts ?? []);
  packageMetadata[9] = JSON.stringify(s.selectedPlan.context ?? []);
  return {
    bom: table([
      [...headings, 'record_type', 'material_id', 'description', 'quantity', 'unit', 'status', 'subject_ids', 'source_ids', 'unresolved_reason', 'document_status'],
      [...packageMetadata, 'package_metadata', '', '', null, '', '', '[]', '[]', '', 'draft'],
      ...s.materials.map(r => [...metadata, 'material', r.id, r.description, r.quantity, r.unit, r.status, JSON.stringify(r.subjectIds), JSON.stringify(r.sourceIds), r.unresolvedReason, 'draft']),
      ...(s.materials.length ? [] : [[...metadata, 'package_status', '', '', null, '', 'unresolved', '[]', '[]', 'No material output supplied.', 'draft']]),
      ...(s.retainedContext ?? []).map(r => [...metadata, 'retained_context', r.id, `${r.kind}${r.label ? ` ${r.label}` : ''}: retained context, not part of this work`, null, '', 'not_purchased', JSON.stringify([r.id]), '[]', null, 'draft']),
    ]),
    cuts: table([
      [...headings, 'record_type', 'piece_id', 'segment_ids', 'joint_ids', 'cut_length', 'unit', 'status', 'source_ids', 'unresolved_reason', 'document_status', 'centerline_length'],
      [...packageMetadata, 'package_metadata', '', '[]', '[]', null, '', '', '[]', '', 'draft', null],
      ...s.cuts.map(r => [...metadata, 'cut', r.pieceId, JSON.stringify(r.segmentIds), JSON.stringify(r.jointIds), r.length, r.unit, r.status, JSON.stringify(r.sourceIds), r.unresolvedReason, 'draft', r.centerline ?? null]),
      ...(s.cuts.length ? [] : [[...metadata, 'package_status', '', '[]', '[]', null, '', 'unresolved', '[]', 'No cut output supplied.', 'draft', null]]),
    ]),
  };
}
