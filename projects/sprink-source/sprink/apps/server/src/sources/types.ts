import type { PdfExcerpt } from './pdf-excerpts.js';
/**
 * Ask Sprink source library contracts.
 *
 * Three layers are kept apart on purpose:
 * 1. Original source text (documents and sections), stored exactly as imported.
 * 2. Explanation notes: plain-language interpretation written by people (or later a model),
 *    stored in their own table and always labelled as interpretation, never as source wording.
 * 3. Executable scripts: the existing core/fabrication functions, reached only through the
 *    validated tool registry in tools.ts. Nothing in the library is executed.
 */

export const SOURCE_TYPES = ['published_code', 'local_amendment', 'manufacturer', 'project_document', 'company_procedure'] as const;
export type SourceType = typeof SOURCE_TYPES[number];
export const SOURCE_TYPE_LABEL: Record<SourceType, string> = {
  published_code: 'Published code or standard',
  local_amendment: 'Local amendment or jurisdiction document',
  manufacturer: 'Manufacturer installation instructions',
  project_document: 'Project specification or approved drawing',
  company_procedure: 'Company procedure',
};

export const SECTION_KINDS = ['requirement', 'exception', 'definition', 'table', 'footnote', 'commentary', 'procedure', 'general'] as const;
export type SectionKind = typeof SECTION_KINDS[number];

export type QualityFlag = 'uncertain_ocr' | 'damaged_table' | 'embedded_instructions';
export const QUALITY_LABEL: Record<QualityFlag, string> = {
  uncertain_ocr: 'Uncertain OCR: check the original page before relying on this wording.',
  damaged_table: 'Damaged table: rows or columns did not parse cleanly. Check the original page.',
  embedded_instructions: 'Contains instruction-like text. It is treated as document content only and never changes how Sprink answers.',
};

/** What the importer must be told before anything is stored. Nothing here is assumed. */
export interface SourceAuthorization {
  /** Who authorized storing and using this document, and on what basis (licence, ownership, public document). */
  basis: string;
  storeAndIndex: boolean;
  useWithAi: boolean;
  /** full: show whole passages. excerpt: show up to maxQuoteChars. reference_only: title and location only. */
  display: 'full' | 'excerpt' | 'reference_only';
  maxQuoteChars?: number;
}

export interface SourceScope {
  /** Standard family for published codes and amendments, e.g. "nfpa13". */
  standard?: string;
  /** Jurisdiction key for local amendments, matching the package's `jurisdiction` fact. */
  jurisdiction?: string;
  /** For amendments: the edition of the standard they amend. */
  amendsEdition?: string;
  /** Manufacturer documents: catalog product ids they cover. */
  productIds?: string[];
  /** Project documents: the project they belong to. */
  projectId?: string;
}

export interface SourceDocumentInput {
  id: string;
  title: string;
  publisher: string;
  type: SourceType;
  edition: string;
  scope: SourceScope;
  /** Link to the original (URL), or omitted when the stored file is the original. */
  url?: string;
  /** True for clearly labelled test documents. They are shown with a Demonstration badge everywhere. */
  demonstration: boolean;
  authorization: SourceAuthorization;
  extraction?: { method: 'text' | 'ocr'; pageConfidence?: Record<string, number> };
  /** Original text: Markdown-style headings for sections, `<!-- page: N -->` page markers. */
  content: string;
  filename: string;
  /** Set when the document came from an uploaded file: which reviewed revision of its text was indexed. */
  upload?: { uploadId: string; revision: number; basis: 'extracted' | 'corrected'; sha256: string; kind: string; pageCount: number };
}

export interface SourceDocument extends Omit<SourceDocumentInput, 'content'> {
  pdf?: { sha256: string; pageCount: number; excerpts?: PdfExcerpt[] };
  sha256: string;
  importedAt: string;
  sectionCount: number;
  flags: QualityFlag[];
}

export interface SourceSection {
  pdfExcerpt?: PdfExcerpt;
  key: string;            // stable storage key: `${docId}#${n}`
  docId: string;
  sectionId: string;      // identifier as printed in the document, e.g. "DEMO-8.2" or "DEMO-8.2 Exception No. 1"
  heading: string;
  kind: SectionKind;
  parentKey: string | null;
  pageStart: number | null;
  pageEnd: number | null;
  text: string;           // original wording, unmodified
  table: string[][] | null;
  references: string[];   // section ids referenced by the text
  amends: string | null;  // for amendments: the section id amended
  flags: QualityFlag[];
  order: number;
  /** Where the passage sits on the uploaded page images, in page-image pixels. */
  regions?: Array<{ page: number; x: number; y: number; w: number; h: number }>;
}

export interface ExplanationCondition {
  id: string;
  /** The focused question to ask when the input is unknown. */
  question: string;
  input: { name: string; unit: 'mm' | 'count' };
  /** The note's reading of when the passage applies, e.g. value <= 600 mm. */
  appliesWhen: { op: '<=' | '<' | '>=' | '>'; value: number };
}

export interface ExplanationNote {
  sectionKey: string;
  text: string;
  author: string;
  topic?: string;
  position?: string;
  conditions?: ExplanationCondition[];
}

/** An import file on disk: metadata plus the path to the original text and optional notes. */
export interface SourcePackageFile {
  document: Omit<SourceDocumentInput, 'content' | 'filename'>;
  file: string;
  explanations?: string;
}
export interface ExplanationFile {
  author: string;
  notes: Array<{ sectionId: string; text: string; topic?: string; position?: string; conditions?: ExplanationCondition[] }>;
}
