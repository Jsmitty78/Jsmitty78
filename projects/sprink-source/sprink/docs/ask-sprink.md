# Shared rule search

Open **Rule search** from the main navigation (`/codes`), or **Codes** inside a work package. Both search the same operator-maintained database. Users enter a question and open cited passages; no document upload, review, registration, demo loading or project setup is part of this workflow.

`POST /api/rules/search` accepts `{ "question": "..." }`. It selects passages with JEV, expands explicit parents, notes, exceptions and references within each matched document, and returns stored wording with edition, page and original links. It does not infer that a rule applies to a particular project. Different jurisdictions and editions are not merged through amendment expansion. Empty results say the requested rule or edition may not be included.

`GET /api/sources` lists shared, non-demonstration, AI-authorized sources only. Project-scoped documents are excluded before retrieval. Existing project-context `/api/ask` behavior remains available for existing integrations; the Rule search UI uses only `/api/rules/search`.

Public source import and demo-loading routes, reference upload, correction and indexing routes have been removed. Site-photo uploads used by other workflows remain available. Existing sources and originals are preserved. Reference uploads cannot be deleted or retried through the public API.

## Operator ingestion

The server uses `SPRINK_DATA_DIR/field.sqlite`. Populate that persistent database before offering search to users. A fresh database contains no rule text; test fixtures are never a production fallback.

1. Obtain a source with permission to store, index, use with AI and display it.
2. Keep the original and provenance. Extract and review text, retaining exact wording, headings and `<!-- page: N -->` markers. Review tables and OCR uncertainty against the original.
3. Create a metadata package alongside the text file:

```json
{
  "file": "manual.md",
  "document": {
    "id": "publisher-manual-revision",
    "title": "Actual source title",
    "publisher": "Actual publisher",
    "type": "manufacturer",
    "edition": "Actual revision",
    "scope": { "productIds": ["actual-product-id"] },
    "url": "https://publisher.example/manual.pdf",
    "demonstration": false,
    "authorization": {
      "basis": "Document the actual permission here",
      "storeAndIndex": true,
      "useWithAi": true,
      "display": "excerpt",
      "maxQuoteChars": 1200
    }
  }
}
```

4. Import using the same data directory as the server:

```sh
SPRINK_DATA_DIR=/absolute/path/to/persistent-data pnpm sources:import /absolute/path/to/manual.source.json
```

Do not set `scope.projectId` for common references. Use `published_code` plus `scope.standard` for licensed codes; use `local_amendment` with jurisdiction, standard and amendsEdition for adopted amendments. Keep versions distinct. Display permissions and OCR/table flags are retained by citation views.

The current local catalog has Spears FlameGuard FG-3-1223 and TYCO TFP171 (August 2026), retained with their original PDFs and provenance in the operator data directory. These are manufacturer instructions, not a full NFPA code collection. NFPA text must be obtained and imported separately before those queries can be answered. The repository does not distribute those local source files or populate a new database automatically.

## Verification

`apps/server/test/rules-search.test.ts` covers project-independent retrieval, exclusion of demo/private sources before retrieval, citations, empty results, input validation, authentication and removed public registration routes. Existing extraction and source authorization tests exercise operator services directly. Rule-search UI verification checks `/codes` and the work-package Codes view against the running persistent database.


## Original PDF results

Search uses indexed text and JEV retrieval only. Results show original PDF pages directly, with document edition and matched page navigation. No answer generation, paraphrase verification, or reconstructed table is performed after retrieval. Page images are prepared once by the operator, not during a search. Text-only references retain their verbatim passage fallback.

Attach an original to an already imported, full-display-authorized document:

```sh
SPRINK_DATA_DIR=/absolute/data pnpm exec tsx scripts/attach-source-pdf.ts document-id /absolute/manual.pdf
```

This validates page bounds, hashes and retains the original, renders every page, then attaches its hash and page count to the stored document. Operators must verify that indexed text and page markers come from that exact edition. Authenticated page routes enforce the current display permission and page bounds. The browser does not accept document uploads.

### Reviewed excerpt views

For a shorter default result, operators can register excerpt boundaries with `scripts/prepare-source-excerpts.ts document-id reviewed-excerpts.json` using the same `SPRINK_DATA_DIR`. The JSON contains the exact attached PDF `sha256` and an `excerpts` array. Each entry identifies an `id`, `sectionKey`, `page`, `label`, exact verbatim `text`, normalized `box` and enclosing `contextBox`, plus `pageWidth` and `pageHeight` for aspect ratio. Visually review the bounds against the original, retaining headings, units, diagrams, qualifications and table footnotes. Bounds are never inferred from the user's query. Reattaching a PDF clears the boundaries so another revision cannot inherit old crops.

Reviewed excerpts enter the existing text search as additional candidates; whole-page text remains searchable. Only explicitly retrieved excerpts receive a cropped view. Other hits use full-page fallback. The client clips the already prepared original page image without generating or rewriting content. Show context expands to the reviewed surrounding region; Full page opens a keyboard-accessible native dialog with zoom. Citation links still resolve to the original stored section. No extra model or image-rendering request runs after retrieval.
