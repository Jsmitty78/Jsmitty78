import type { SourceStore } from './store.js';
import type { ExplanationNote, SourceDocument, SourceSection } from './types.js';

export type Role = 'main' | 'exception' | 'footnote' | 'referenced' | 'definition' | 'commentary' | 'amendment' | 'related';
export interface Retrieved { section: SourceSection; doc: SourceDocument; role: Role; via?: string; score: number; notes: ExplanationNote[] }

/** Expands the main passages with what a reader needs to apply them correctly. */
export function expand(store: SourceStore, mains: Retrieved[], applicable: SourceDocument[]): Retrieved[] {
  const out = new Map<string, Retrieved>();
  const add = (r: Retrieved) => { if (!out.has(r.section.key)) out.set(r.section.key, r); };
  const docSections = new Map(applicable.map(d => [d.id, store.sections(d.id)]));
  const topSection = (docId: string, ref: string) => {
    const list = docSections.get(docId) ?? [];
    const exact = list.find(s => s.sectionId === ref);
    if (exact) return exact;
    return list.filter(s => s.parentKey === null && ref.startsWith(`${s.sectionId}.`)).sort((a, b) => b.sectionId.length - a.sectionId.length)[0];
  };
  const withNotes = (section: SourceSection, doc: SourceDocument, role: Role, via: string): Retrieved =>
    ({ section, doc, role, via, score: 0, notes: store.notes(section.key) });
  for (const m of mains) add(m.doc.type === 'local_amendment' && m.section.amends ? { ...m, role: 'amendment', via: m.section.amends } : m);
  // Visit additions too: referenced clauses and amendments can carry their own exceptions
  // and references. The key map terminates cycles without dropping qualifications.
  for (const m of out.values()) {
    const list = docSections.get(m.doc.id) ?? [];
    const parentKey = m.section.pdfExcerpt?.sectionKey ?? m.section.parentKey;
    if (parentKey) {
      const parent = list.find(s => s.key === parentKey);
      if (parent) {
        add(withNotes(parent, m.doc, 'referenced', m.section.sectionId));
        if (!m.section.pdfExcerpt) out.set(m.section.key, { ...m, role: m.section.kind === 'exception' ? 'exception' : 'footnote', via: parent.sectionId });
      }
    }
    for (const child of list.filter(s => s.parentKey === m.section.key))
      add(withNotes(child, m.doc, child.kind === 'exception' ? 'exception' : 'footnote', m.section.sectionId));
    for (const ref of m.section.references) {
      const target = topSection(m.doc.id, ref);
      if (target) add(withNotes(target, m.doc, 'referenced', m.section.sectionId));
    }
    if (m.doc.type !== 'published_code') continue;
    for (const amendDoc of applicable.filter(d => d.type === 'local_amendment'
      && d.scope.standard === m.doc.scope.standard && d.scope.amendsEdition === m.doc.edition
      && d.demonstration === m.doc.demonstration)) {
      for (const s of docSections.get(amendDoc.id) ?? []) {
        if (s.amends && (s.amends === m.section.sectionId || s.amends.startsWith(`${m.section.sectionId}.`)))
          add(withNotes(s, amendDoc, 'amendment', m.section.sectionId));
      }
    }
  }
  return [...out.values()];
}

export interface Conflict { topic: string; items: Array<{ key: string; position: string }>; resolution: string }

/** Different positions on one topic from different documents. Sprink shows them; it never picks one. */
export function conflicts(items: Retrieved[]): Conflict[] {
  const byTopic = new Map<string, Array<{ key: string; position: string; docId: string }>>();
  for (const r of items) for (const n of r.notes) {
    if (!n.topic || !n.position) continue;
    byTopic.set(n.topic, [...(byTopic.get(n.topic) ?? []), { key: r.section.key, position: n.position, docId: r.doc.id }]);
  }
  const out: Conflict[] = [];
  for (const [topic, list] of byTopic) {
    if (new Set(list.map(x => x.docId)).size < 2 || new Set(list.map(x => x.position)).size < 2) continue;
    const docTypes = new Set(list.map(x => items.find(i => i.section.key === x.key)!.doc.type));
    const resolution = docTypes.has('local_amendment')
      ? 'A local amendment is among these sources. Confirm its jurisdiction, edition and adoption with the authority having jurisdiction before deciding which wording governs.'
      : 'These documents say different things. Confirm with the engineer of record or project manager which one governs before you work.';
    out.push({ topic: list.some(x => items.find(r => r.section.key === x.key)!.doc.authorization.display !== 'full') ? 'Conflicting source interpretations (display restricted)' : topic, items: list.map(({ key, position }) => ({ key, position: items.find(r => r.section.key === key)!.doc.authorization.display === 'full' ? position : 'Display restricted; inspect the authorized original.' })), resolution });
  }
  return out;
}
