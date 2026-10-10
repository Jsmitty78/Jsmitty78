import type { SourceSearch } from '../../src/sources/semantic.js';
// Scripted service decisions for downstream regressions, NOT a semantic-search benchmark.
const selections: Record<string, string[]> = {
  'How long must solvent cement cure before hydrostatic testing?': ['S-5.2'],
  'How close to a change in direction does a hanger need to be on a CPVC branch line?': ['S-4.1'],
  'Does the installation pass inspection? Check the handling notes.': ['S-5.3'],
  'Can CPVC piping be painted?': ['PS-2.4'],
  'What clearance to ductwork does the company procedure require?': ['UC-1.1'],
  'What is the maximum spacing of sidewall sprinklers?': [],
  'What is the maximum spacing between sidewall sprinklers in a light hazard occupancy?': [],
  'How far must CPVC pipe be kept from heat sources?': ['DEMO-M-4.2'],
};
export const scriptedSearch: SourceSearch = {
  async select(q, passages) {
    const ids = selections[q];
    return passages.filter(p => ids ? ids.includes(p.section.sectionId) : p.section.parentKey === null && (p.section.kind !== 'table' || p.section.sectionId === 'Table DEMO-8.2')).map(p => p.section.key);
  },
};
