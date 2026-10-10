import PDFDocument from 'pdfkit';
import { ExportError, type ExportSnapshot, type PlanView } from './types.js';
import { unresolved } from './snapshot.js';

export interface PdfOptions { /** Use a Unicode TTF/OTF for non-ASCII project text. */ fontPath?: string }
export async function renderPdf(s: ExportSnapshot, options: PdfOptions = {}): Promise<Buffer> {
  if (!options.fontPath && /[^\x20-\x7e\r\n\t]/u.test(JSON.stringify(s))) {
    throw new ExportError(422, 'Non-ASCII text requires a configured Unicode PDF font. No text was replaced or discarded.');
  }
  const doc = new PDFDocument({ size: 'A4', margin: 42, bufferPages: true, autoFirstPage: false,
    info: { Title: s.title, Author: 'Sprink', Subject: 'Draft work package. Export does not establish construction approval.' } });
  const chunks: Buffer[] = [];
  const finished = new Promise<Buffer>((resolve, reject) => {
    doc.on('data', chunk => chunks.push(Buffer.from(chunk)));
    doc.on('end', () => resolve(Buffer.concat(chunks)));
    doc.on('error', reject);
  });
  const font = options.fontPath ?? 'Helvetica';
  let y = 100;
  const left = 42, width = 511, bottom = 776;
  const clean = (text: string) => text.replace(/[\r\t]/g, ' ');
  const at = (text: string, x: number, top: number, size = 9, color = '#243447') => {
    doc.font(font).fontSize(size).fillColor(color).text(clean(text), x, top, { lineBreak: false });
  };
  const wrap = (text: string, maxWidth: number, size = 9): string[] => {
    doc.font(font).fontSize(size);
    const lines: string[] = [];
    for (const paragraph of clean(text).split('\n')) {
      let line = '';
      for (const word of paragraph.split(/(\s+)/)) {
        if (line && doc.widthOfString(line + word) > maxWidth) { lines.push(line.trimEnd()); line = ''; }
        const token = line ? word : word.trimStart();
        for (const char of token) {
          if (line && doc.widthOfString(line + char) > maxWidth) { lines.push(line); line = ''; }
          line += char;
        }
      }
      lines.push(line);
    }
    return lines;
  };
  const page = () => {
    doc.addPage(); y = 100;
    at('SPRINK / WORK PACKAGE', left, 30, 10, '#235B67');
    at('DRAFT - human review required', left, 50, 17);
    at(`Revision ${s.binding.inputRevision} | ${s.intent === 'adapt_to_site' ? 'Site adaptation' : 'Drawing preparation'}`, left, 76, 9);
    doc.moveTo(left, 93).lineTo(left + width, 93).strokeColor('#CDD9DF').stroke();
  };
  const need = (height: number) => { if (y + height > bottom) page(); };
  const paragraph = (text: string, size = 10) => {
    for (const line of wrap(text, width, size)) { need(15); at(line, left, y, size); y += 15; }
    y += 6;
  };
  const heading = (text: string) => {
    need(90); y += 10;
    for (const line of wrap(text, width, 13)) { need(18); at(line, left, y, 13, '#235B67'); y += 18; }
    y += 7;
  };
  const table = (headers: string[], widths: number[], rows: string[][]) => {
    const header = () => {
      need(35); doc.rect(left, y, width, 24).fill('#EAF0F3');
      let x = left;
      headers.forEach((h, i) => { at(h, x + 5, y + 7, 8); x += widths[i]; });
      y += 24;
    };
    const firstHeight = rows.length ? Math.max(...rows[0].map((cell, i) => wrap(cell, widths[i] - 10, 8).length)) * 11 + 10 : 30;
    need(24 + Math.min(firstHeight, 180));
    header();
    for (const row of rows) {
      const lines = row.map((cell, i) => wrap(cell, widths[i] - 10, 8));
      const count = Math.max(...lines.map(l => l.length));
      if (count * 11 + 10 <= 180 && y + count * 11 + 10 > bottom) { page(); header(); }
      let offset = 0;
      while (offset < count) {
        if (bottom - y < 26) { page(); header(); }
        const take = Math.min(count - offset, Math.floor((bottom - y - 10) / 11));
        const height = take * 11 + 10;
        let x = left;
        lines.forEach((cell, i) => {
          doc.rect(x, y, widths[i], height).lineWidth(0.4).strokeColor('#CDD9DF').stroke();
          const visible = cell.slice(offset, offset + take);
          if (i === 0 && offset > 0 && !visible.length) visible.push((cell[0] ?? '') + ' (cont.)');
          visible.forEach((line, j) => at(line, x + 5, y + 5 + j * 11, 8));
          x += widths[i];
        });
        y += height; offset += take;
        if (offset < count) { page(); at('Table row continued from previous page', left, y, 8); y += 16; header(); }
      }
    }
    if (!rows.length) paragraph('No rows supplied. See unresolved items.');
    y += 10;
  };
  const plan = (view: PlanView, label: string) => {
    need(300);
    heading(label + ': ' + view.title);
    paragraph(`Plan ${view.id} | coordinate unit: ${view.unit}. Schematic projections, not a scale template. Labels match piece/joint tables.`);
    // Two projections preserve elevation changes that a plan-only view would hide.
    for (const axes of [[0, 1, 'Plan X/Y'], [0, 2, 'Elevation X/Z']] as const) {
      need(235);
      const top = y;
      doc.rect(left, top, width, 220).lineWidth(0.6).strokeColor('#CDD9DF').stroke();
      at(axes[2], left + 10, top + 8, 9);
      const points = [...view.segments.flatMap(r => [r.from, r.to]), ...view.joints.map(r => r.position), ...(view.context ?? []).flatMap(r => r.positions)];
      if (!points.length) { at('Geometry unavailable', left + 10, top + 40); y += 230; continue; }
      const a = axes[0], b = axes[1];
      const minA = Math.min(...points.map(p => p[a])), maxA = Math.max(...points.map(p => p[a]));
      const minB = Math.min(...points.map(p => p[b])), maxB = Math.max(...points.map(p => p[b]));
      const scale = Math.min(420 / Math.max(maxA - minA, 1), 130 / Math.max(maxB - minB, 1));
      const xy = (p: number[]): [number, number] => [left + 40 + (p[a] - minA) * scale, top + 175 - (p[b] - minB) * scale];
      const occupied: { x: number; y: number; w: number }[] = [];
      const annotate = (text: string, preferredX: number, preferredY: number, size = 7) => {
        doc.font(font).fontSize(size);
        const w = doc.widthOfString(text);
        for (let lane = 0; lane < 8; lane++) {
        const x = Math.max(left + 6, Math.min(preferredX + (lane % 2 ? -1 : 1) * Math.ceil(lane / 2) * (w + 12), left + width - w - 6));
        for (let step = 0; step < 40; step++) {
          const offset = Math.ceil(step / 2) * 11 * (step % 2 ? 1 : -1);
          const yy = Math.max(top + 28, Math.min(preferredY + offset, top + 204));
          if (occupied.some(r => x < r.x + r.w + 3 && x + w + 3 > r.x && yy < r.y + 10 && yy + 10 > r.y)) continue;
          occupied.push({ x, y: yy, w }); at(text, x, yy, size); return;
        }
        }
        // Dense projections retain a complete, unambiguous callout table below.
      };
      const contextLanes = new Map<string, number>();
      (view.context ?? []).forEach((r, index) => {
        const pts = r.positions.map(xy);
        if (r.kind === 'pipe' && pts.length === 2) doc.moveTo(...pts[0]).lineTo(...pts[1]).lineWidth(1).strokeColor('#8B9298').stroke();
        else pts.slice(0, 1).forEach(([x, cy]) => doc.circle(x, cy, 4).strokeColor('#8B9298').stroke());
        const label = r.kind === "pipe" && pts.length === 2 ? [(pts[0][0] + pts[1][0]) / 2, (pts[0][1] + pts[1][1]) / 2] : pts[0];
        if (label) {
          const key = `${label[0].toFixed(1)}:${label[1].toFixed(1)}`;
          const lane = contextLanes.get(key) ?? 0;
          contextLanes.set(key, lane + 1);
          const source = r.sourceLabel && r.sourceLabel.length <= 6 ? ` / ${r.sourceLabel}` : '';
          annotate(`C${index + 1}${source}`, label[0] - 18, label[1] - 18 - lane * 10);
        }
      });
      view.segments.forEach((r, index) => {
        const [x1, y1] = xy(r.from), [x2, y2] = xy(r.to);
        doc.moveTo(x1, y1).lineTo(x2, y2).lineWidth(2).strokeColor('#235B67').stroke();
        // Numbered callouts avoid unbounded user IDs overflowing the drawing.
        annotate(`${index + 1}${r.sourceLabel && r.sourceLabel.length <= 6 ? ` / ${r.sourceLabel}` : ""}`, (x1 + x2) / 2 + 4, (y1 + y2) / 2 - 13, 8);
      });
      const jointLanes = new Map<string, number>();
      view.joints.forEach((r, index) => {
        const [x, cy] = xy(r.position);
        const key = `${x.toFixed(1)}:${cy.toFixed(1)}`, lane = jointLanes.get(key) ?? 0;
        jointLanes.set(key, lane + 1);
        doc.circle(x, cy, 3).fill('#E4A03B'); annotate(`J${index + 1}`, x + 5, cy + 4 + lane * 10);
      });
      y += 230;
    }
    table(['Callout', 'Segment / pieces', 'Coordinates (' + view.unit + ')'], [55, 220, 236], view.segments.map((r, i) => [String(i + 1), `${r.id}${r.sourceLabel ? ` / source ${r.sourceLabel}` : ""}\nPieces: ${r.pieceIds.join(', ') || 'unresolved'}`, `${r.from.join(', ')} -> ${r.to.join(', ')}`]));
    if (view.context?.length) table(['Context', 'Retained item (not purchase)', 'Coordinates (' + view.unit + ')'], [55, 220, 236], view.context.map((r, i) => [`C${i + 1}`, `${r.id}${r.sourceLabel ? ` / source ${r.sourceLabel}` : ""} (${r.kind})`, r.positions.map(p => p.join(', ')).join(' -> ') || 'Unknown position']));
    table(['Callout', 'Joint', 'Coordinates (' + view.unit + ')'], [55, 220, 236], view.joints.map((r, i) => [`J${i + 1}`, r.id, r.position.join(', ')]));
  };
  try {
    page(); heading(s.title); paragraph(s.scope);
    paragraph('Construction approval: not established by this export. Selection, successful calculations and available files do not constitute approval.');
    paragraph('Drawing: ' + s.drawingReference);
    if (s.siteReview) {
      heading('Site change and designer response');
      paragraph(s.siteReview.reason);
      paragraph('Required review: supports, fixed-end assembly/access, head coverage and hydraulic impact. A recorded response does not turn unknown checks into passes.');
      for (const e of s.siteReview.evidence) {
        if(e.image) page();
        paragraph(`${e.label} | page ${e.page} | ${e.synthetic?'SYNTHETIC TEST EVIDENCE':'Recorded source'}`);
        if(e.image) { doc.image(Buffer.from(e.image,'base64'),left,y,{fit:[511,450]}); y+=465; }
      }
      s.siteReview.readings.forEach(reading => paragraph(reading));
      if(s.siteReview.alternatives?.length){heading('Alternative comparison');paragraph('Metrics describe proposed centerlines, not approval or fabrication readiness. Historical calculations are labelled and must be revalidated after inputs change.');table(['Alternative','Geometry / delta','Cut dimensions','Calculation binding'],[125,110,150,126],s.siteReview.alternatives.map(a=>[a.label,a.metrics,a.cuts,a.binding]));}
      for(const r of s.siteReview.reviews) { paragraph(`${r.decision} by ${r.reviewer} at ${r.recordedAt}; revision ${r.inputRevision}; ${r.current?'response to current geometry':'SUPERSEDED: re-review required'}\n${r.conditions}`);for(const c of r.checks??[])paragraph(`${c.topic}: ${c.answer||'UNCONFIRMED'}; evidence: ${c.evidence||'not supplied'}`); }
    }
    table(['Binding', 'Value'], [150, 361], Object.entries(s.binding).map(([key, value]) => [key, String(value)]));
    if (s.inputFacts?.length) {
      heading('Saved source and site inputs');
      paragraph('Values below preserve their saved provenance and confirmation. Drawing labels are distinct from application IDs. Synthetic assumptions and proposed values are not field measurements.');
      table(['Field / subjects', 'Value / evidence'], [160, 351], s.inputFacts.map(f => [
        `${f.field}\nSubjects: ${f.subjectIds.join(', ') || 'package'}\nID: ${f.id}`,
        `${f.value ?? 'UNKNOWN'} ${f.unit ?? ''}\n${f.confirmation}; ${f.provenance}; ${f.context}\n${f.source.description}\nAsset: ${f.source.assetId ?? 'none'}; page: ${f.source.page ?? 'unknown'}${f.unknownReason ? `\n${f.unknownReason}` : ''}`,
      ]));
    }
    const gaps = unresolved(s);
    heading('Unresolved items and review conditions');
    if (!gaps.length) paragraph('No unresolved items reported by the supplied outputs. This is not a compliance or constructability certification.');
    gaps.forEach((gap, i) => paragraph(`${i + 1}. ${gap}`));
    if (s.baselinePlan) plan(s.baselinePlan, 'Before / unchanged baseline');
    plan(s.selectedPlan, s.intent === 'adapt_to_site' ? 'After / selected proposal' : 'Numbered work plan');
    heading('Material quantities');
    paragraph('Modeled quantities from the selected plan; physical fabrication splits may remain unresolved. Purchasing stock and allowances are not inferred. Numeric values are preserved without added rounding.');
    table(['Material / subjects', 'Quantity / unit', 'Status / sources / notes'], [205, 100, 206], s.materials.map(r => [`${r.id}: ${r.description}\nSubjects: ${r.subjectIds.join(', ')}`, r.quantity === null ? `UNRESOLVED\n${r.unit}` : `${r.quantity}\n${r.unit}`, `${r.status}\nSources: ${r.sourceIds.join(', ') || 'none'}\n${r.unresolvedReason ?? ''}`]));
    heading('Cut list');
    table(['Piece / segments / joints', 'Cut / unit', 'Status / sources / notes'], [205, 100, 206], s.cuts.map(r => [`${r.pieceId}\nSegments: ${r.segmentIds.join(', ')}\nJoints: ${r.jointIds.join(', ')}`, `${r.length === null ? 'UNRESOLVED' : r.length}\n${r.unit}${r.centerline != null ? `\nCenterline: ${r.centerline} ${r.unit}` : ''}`, `${r.status}\nSources: ${r.sourceIds.join(', ') || 'none'}\n${r.unresolvedReason ?? ''}`]));
    if (s.retainedContext?.length) {
      heading('Retained context');
      paragraph('Shown on the drawing for traceability. Outside this work: not detailed, not connected and not purchased.');
      table(['Entity', 'Kind', 'Drawing label'], [150, 150, 211], s.retainedContext.map(r => [r.id, r.kind, r.label ?? 'not labelled']));
    }
    heading('Assembly sequence and joint references');
    table(['Operation / references', 'Instruction / evidence / conditions'], [160, 351], s.assembly.map((r, i) => [`${i + 1}. ${r.id}\nPieces: ${r.pieceIds.join(', ')}\nJoints: ${r.jointIds.join(', ')}`, `${r.instruction}\nStatus: ${r.status}\nSources: ${r.sourceIds.join(', ') || 'none'}\n${r.unresolvedReason ?? ''}`]));
    if (s.intent === 'adapt_to_site') {
      heading('Change summary');
      paragraph('Proposed reuse is not permission to reuse. Baseline facts remain unchanged.');
      table(['Category / subjects', 'Before -> after / description / evidence'], [160, 351], s.changes.map(r => [`${r.kind} / ${r.entityType}\n${r.id}\n${r.subjectIds.join(', ')}`, `${r.before ?? 'not supplied'} -> ${r.after ?? 'not supplied'}\n${r.description}\nSources: ${r.sourceIds.join(', ') || 'none'}`]));
    }
    heading('Rule findings');
    table(['Finding / status', 'Subjects / finding / sources'], [150, 361], s.findings.map(r => [`${r.id}\n${r.status}`, `${r.subjectIds.join(', ')}\n${r.description}\nSources: ${r.sourceIds.join(', ') || 'none'}`]));
    if (s.inputs?.length) {
      heading('Recorded inputs and provenance');
      paragraph('Values as saved in the work package. TEST ASSUMPTION rows are fictional values for exercising the software, not field observations; confirming them does not change that.');
      const basis = { test_assumption: 'TEST ASSUMPTION', sample: 'SAMPLE', recorded: 'Recorded' } as const;
      table(['Input / subjects', 'Value / unit', 'Basis / status / source'], [205, 100, 206], s.inputs.map(r => [
        `${r.field}\n${r.subjectIds.length ? `Subjects: ${r.subjectIds.join(', ')}` : 'Package-wide'}`,
        r.value === null ? 'UNKNOWN' : `${r.value}${r.unit ? ` ${r.unit}` : ''}`,
        `${basis[r.basis]} | ${r.status}\n${r.source}${r.evidenceAssetId ? `\nEvidence file: ${r.evidenceAssetId}` : ''}`,
      ]));
    }
    heading('Source references');
    table(['Source ID', 'Document / reference'], [110, 401], s.sources.map(r => [r.id, `${r.title}\n${r.reference}`]));
    const range = doc.bufferedPageRange();
    for (let i = range.start; i < range.start + range.count; i++) {
      doc.switchToPage(i); at(`DRAFT | Revision ${s.binding.inputRevision} | Page ${i + 1} of ${range.count}`, left, 806, 8, '#647684');
    }
    doc.end();
  } catch (error) { doc.destroy(); throw error; }
  return finished;
}
