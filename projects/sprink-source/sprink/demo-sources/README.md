# Demonstration source documents (not real code text)

Everything in this folder was written by the Sprink team to test the Ask Sprink flow. **None of it is text from NFPA 13, a San Francisco amendment, Spears, or any real project or company.** Section numbers carry a `DEMO-` prefix so they cannot be mistaken for real provisions, every document is imported with `demonstration: true`, and the app shows a Demonstration badge on every passage from these files.

The values (clearances, hanger distances, exception limits) are invented. They exist so the tests can check edition selection, exceptions, conflicts, tables, footnotes, OCR flags and instruction-injection handling. Do not use them for work.

| File | Stands in for | Type |
| --- | --- | --- |
| `demo-nfpa13-2025` | NFPA 13, 2025 edition | Published code |
| `demo-nfpa13-2022` | NFPA 13, 2022 edition (different invented values) | Published code |
| `demo-sf-amendments-2025` | San Francisco local amendments to the 2025 edition | Local amendment |
| `demo-cpvc-install` | Manufacturer installation instructions for the Spears FlameGuard products in the catalog | Manufacturer |
| `demo-project-spec` | A project specification section | Project document |
| `demo-company-procedure` | A company field procedure | Company procedure |

Each document has three files, kept apart on purpose:

- `*.md`: the "original" text as it would be imported.
- `*.source.json`: metadata and the authorization statement.
- `*.explanations.json`: plain-language notes about sections. These are interpretation, stored separately from the source text, and shown as "Sprink note", never as source wording.

Real documents are imported the same way (see `docs/ask-sprink.md`), but only when you are authorized to store, index and use them with AI.
