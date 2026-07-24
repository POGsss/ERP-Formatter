# REVISION.md

### ERP Formatter Revision — Template List + New POS Template

Source: Assessment of `backend/routers/upload.py`, `backend/routers/template_mode.py`,
`backend/routers/admin.py`, `backend/services/transformer.py`, `backend/services/file_reader.py`,
`backend/services/file_writer.py`, `backend/database.py`, `frontend/app/page.tsx`,
`frontend/components/*`, and `frontend/types/index.ts`.

See `docs/REVISION_CONTEXT.md` for the full assessment, the New POS input/output mapping, the
payment method table, the worked example, and the open assumptions. This file contains the phased
implementation plan.

Reference sample files: `docs/Template/expectedInput.xlsx` (New POS input) and
`docs/Template/expectedOutput.xlsx` (expected New POS output).

---

## 1. Phase 1 — New POS Template Transformation Engine

### Overview

Add a new backend transformer that converts the payment-method breakdown export into per-payment
ERP rows. This phase is self-contained: it can be built and unit-tested directly against the
sample files `docs/Template/expectedInput.xlsx` and `docs/Template/expectedOutput.xlsx` before any
wiring or UI work. It must not touch the existing `DataTransformer` (Old POS) behavior.

### User Stories

- As accounting, I want each payment method in the daily breakdown export turned into its own ERP
  row so every payment channel becomes a separate sale invoice line.
- As a developer, I want the New POS logic isolated in its own transformer so the standard flow
  stays untouched.

### Requirements

- Add a `NewPosTransformer` (new file `backend/services/new_pos_transformer.py`, or a new class in
  the services layer) that returns the same `TransformResult` dataclass shape used by the standard
  transformer (`output_df`, `row_count`, `error_count`, `warnings`, `errors`, `column_summary`),
  so `FileWriter` and the upload/preview responses work unchanged.
- Input columns: `Business Date`, `Store`, `Payment Method`, `Gross Sale`, `VAT Amount`,
  `Gross Sale w/o VAT`, `Discount Amount`, `Net Sale`. Match column names case-insensitively and
  whitespace-tolerantly (reuse the alias-lookup approach already in `transformer.py`).
- Fill `Business Date` (and `Store`) downward so every payment-method row inherits its group's
  Business Date.
- Skip Total rows (Store cell contains "Total", case-insensitive) and any row with an empty
  Payment Method.
- Emit exactly one output row per remaining payment-method row.
- Output these 11 columns in this exact order:
  `SI Number`, `Invoice Date`, `Product Code`, `Quantity`, `Amount`, `Sales Discount`,
  `VAT Payable`, `Customer Code`, `Doc Class`, `Currency Code`, `Remarks`.
- Field rules:
  - `Amount` = `Gross Sale w/o VAT` (strip `₱`, spaces, commas → float; missing/invalid → 0).
  - `Sales Discount` = `Discount Amount` (same numeric parsing).
  - `VAT Payable` = `VAT Amount` (same numeric parsing).
  - `Invoice Date` = Business Date parsed as `MM/DD/YYYY`, written as a real date.
  - `Product Code` = `001`.
  - `Quantity` = `0`.
  - `Doc Class` = `RR1`.
  - `Currency Code` = `PHP`.
  - `Remarks` = empty string.
  - `SI Number` = `"RR1"` + Customer letter + Business Date `MMDD` (two-digit month + two-digit
    day). Example: `09/07/2026` + `Card(DEBIT)` → `RR1M0907`.
  - `Customer Code` and Customer letter come from the payment method mapping.
- Payment method mapping (define as a constant dict; match case-insensitively + whitespace
  normalized):

  | Payment Method | Customer Code | Customer letter |
  | :--- | :--- | :--- |
  | Card(DEBIT) | 72 | M |
  | Card(MASTER) | 72 | M |
  | cash | 68 | C |
  | Other( E-Wallet ) | 72 | M |
  | Other( FoodPanda ) | 70 | F |
  | Other( GrabFood ) | 71 | G |
  | Other( Pickup Coffee App ) | 69 | B |

- Edge cases:
  - Unknown payment method → add a per-row warning, emit the row with a safe fallback letter
    (e.g. `X`) and a blank/`0` Customer Code so processing does not fail.
  - Missing/unparseable Business Date → add a per-row warning and use today's date for that row.
  - Missing/non-numeric money value → treat as `0`.
- Build a `column_summary` (list of `{column, source, status}`) so the Output Preview renders,
  matching the style used by the existing transformers (`mapped` / `computed` / `hardcoded`).
- Reuse the numeric/date parsing helpers from `transformer.py` where practical (currency-symbol
  stripping must be added — the current `_try_parse_float` strips commas but not `₱`).

### Tasks

1. Create `backend/services/new_pos_transformer.py` with a `NewPosTransformer.transform(df)` that
   returns a `TransformResult`.
2. Add the payment-method mapping constant and a case-insensitive lookup helper.
3. Implement Business Date / Store fill-down and Total-row / empty-payment-method skipping.
4. Implement numeric parsing that strips `₱`, spaces, and commas.
5. Implement SI Number composition (`RR1` + letter + `MMDD`) and `MM/DD/YYYY` date parsing.
6. Build the 11-column output DataFrame in the exact column order.
7. Build `column_summary`, `warnings`, and `errors`.
8. Add a `__main__` smoke block (mirroring `transformer.py`) that reads
   `docs/Template/expectedInput.xlsx` and prints the output, for quick local verification.

### Expected Output

- `backend/services/new_pos_transformer.py` — the New POS transformer returning `TransformResult`.
- Running the transformer on `docs/Template/expectedInput.xlsx` reproduces the worked example in
  `docs/REVISION_CONTEXT.md` (matching `docs/Template/expectedOutput.xlsx`).

### Acceptance Criteria

- [ ] `docs/Template/expectedInput.xlsx` produces exactly 7 rows (one per payment method), Total
      row skipped.
- [ ] Amount / Sales Discount / VAT Payable match the sample (`280.35 / 0 / 33.65`,
      `10550.83 / 62.14 / 1228.88`, etc.).
- [ ] SI Numbers are `RR1M0907`, `RR1M0907`, `RR1C0907`, `RR1M0907`, `RR1F0907`, `RR1G0907`,
      `RR1B0907`.
- [ ] Customer Codes are `72, 72, 68, 72, 70, 71, 69` (per payment method).
- [ ] Output columns appear in the exact 11-column order.
- [ ] Product Code = `001`, Quantity = `0`, Doc Class = `RR1`, Currency Code = `PHP`,
      Remarks empty on every row.
- [ ] Unknown payment method and missing date produce warnings but do not crash processing.
- [ ] The standard `DataTransformer` output is byte-for-byte unchanged.

---

## 2. Phase 2 — Template Registry & Template-Aware Processing

### Overview

Introduce a small template registry, route processing to the correct transformer based on a
selected template, persist the chosen template on each upload, and make reprocess reuse it. Expose
the template list to the frontend. This phase wires Phase 1 into the pipeline and prepares the
`template` parameter the UI needs in Phase 3.

### User Stories

- As an operator, I want the POS file processed with the template I selected so I get the right
  output format.
- As an operator, I want reprocessing an old upload to use the same template it was created with.
- As a developer, I want one place that lists the available templates so the UI and backend agree.

### Requirements

- Define a template registry (e.g. `backend/services/templates.py`) with the two templates:
  - key `old_pos`, label `Old POS Template`, description, transformer = existing `DataTransformer`.
  - key `new_pos`, label `New POS Template`, description, transformer = `NewPosTransformer`.
  - `old_pos` is the default.
- Add `GET /api/templates` returning the list of `{ key, label, description, is_default }`.
- Update `POST /api/upload` to accept an optional `template` form field (default `old_pos`):
  - Unknown template → return a readable validation error (reuse `_validation_failure`).
  - Select the transformer from the registry and run it instead of hardcoding `DataTransformer`.
  - When calling `FileWriter().write(...)`, pass the template's numeric/date column sets (see
    below) so New POS numeric/date columns format correctly.
- Persist the template on the upload record:
  - Add a `template` column to the `uploads` table (TEXT, default `old_pos`).
  - Add `template` to `UPLOAD_COLUMNS` in `database.py`.
  - In `init_db`, add a guarded migration: check `PRAGMA table_info(uploads)` and
    `ALTER TABLE uploads ADD COLUMN template TEXT DEFAULT 'old_pos'` if the column is missing.
  - Store the chosen `template` when inserting the upload.
- Update `FileWriter.write()` to accept optional `number_columns` and `date_columns` arguments,
  defaulting to the current standard sets, so New POS can pass its own
  (`{Amount, Sales Discount, VAT Payable, Quantity, Product Code}` and `{Invoice Date}`) without
  changing standard behavior.
- Update reprocess (`POST /api/admin/uploads/{id}/reprocess`) to read the stored `template`,
  select the matching transformer, and pass the matching writer column sets.
- Include the template on the upload-history API responses (`_upload_history_item`,
  `_admin_upload_history_item`) so the UI can show which template was used.
- Remove the manual template-mapping path from active use:
  - The UI stops calling `POST /api/transform/with-template` (handled in Phase 3).
  - Recommended: delete `backend/routers/template_mode.py` and its route registration once Phase 3
    lands. If kept temporarily, it must not interfere with the new flow.

### Tasks

1. Create `backend/services/templates.py` with the registry and a `get_transformer(key)` helper.
2. Add `GET /api/templates` (in `upload.py` or a small `templates` router) and register it.
3. Add the `template` column + guarded migration in `database.py`; add it to `UPLOAD_COLUMNS`.
4. Update `POST /api/upload` to read/validate `template`, pick the transformer, store the value,
   and pass writer column sets.
5. Update `FileWriter.write()` to accept `number_columns` / `date_columns` overrides.
6. Update reprocess in `admin.py` to reuse the stored template + column sets.
7. Add `template` to both upload-history response builders.
8. Remove or neutralize the `/api/transform/with-template` flow (coordinate with Phase 3).

### Expected Output

- `backend/services/templates.py` — template registry + transformer lookup.
- Updated `backend/routers/upload.py` — template-aware upload + `GET /api/templates`.
- Updated `backend/routers/admin.py` — template-aware reprocess.
- Updated `backend/services/file_writer.py` — configurable numeric/date columns.
- Updated `backend/database.py` — `template` column + migration.

### Acceptance Criteria

- [ ] `GET /api/templates` returns `old_pos` (default) and `new_pos` with labels/descriptions.
- [ ] `POST /api/upload` with `template=new_pos` runs the New POS transformer and writes a valid
      workbook with correctly typed numeric/date cells.
- [ ] `POST /api/upload` with no `template` behaves exactly like today (Old POS).
- [ ] An unknown `template` returns a 400 validation error.
- [ ] The chosen template is saved on the upload row and returned in upload-history responses.
- [ ] Reprocessing a `new_pos` upload re-runs the New POS transformer; reprocessing an `old_pos`
      upload re-runs the standard transformer.
- [ ] Existing databases migrate cleanly: old rows get `template = 'old_pos'` and still reprocess.
- [ ] Standard 12-column output and Default Settings are unchanged.

---

## 3. Phase 3 — Template List & Process / Template Tab UI

### Overview

Replace the "Standard / Template" tabs and the manual template-mapping UI with "Process / Template"
tabs and a template selection list. The Process tab keeps the upload area and the process card. The
Template tab shows the template list and hides the process card, letting the top card expand to
fill the freed height. Processing sends the selected template to the backend.

### User Stories

- As an operator, I want to pick a template from a list instead of uploading and mapping a template
  file.
- As an operator, I want to see which template is active while I process a file.
- As an operator, I want the interface to feel clean: no leftover mapping table or template
  drop zone.

### Requirements

- Rename the two mode tabs to `Process` and `Template` (replace `standard` / `template` mode
  values with `process` / `template`).
- Fetch templates from `GET /api/templates` on load; default the selected template to the one
  flagged default (`old_pos`). Keep a hardcoded fallback list if the fetch fails.
- **Template tab:**
  - Top card shows the template list (radio-style selectable rows: label + short description),
    with the active template clearly indicated.
  - Selecting a template updates the active selection and persists it in page state.
  - The bottom process card is **hidden**; the top card expands so its height fills the combined
    height previously used by the top + bottom cards. (The current layout already measures
    `uploadColumnRef` height for the Recent Upload panel — keep that in sync so the right column
    still matches.)
  - No file upload, no drop zone, no "Analyze Mapping" button in this tab.
- **Process tab:**
  - Top card shows the single POS file drop zone (as the current Standard mode does).
  - Bottom card = `UploadSummaryPanel` with the process button (label `Process` / `Processing`).
  - Show the active template name somewhere on this tab (e.g. a small badge or line in the
    summary panel) so the operator knows which format will be produced.
- Processing (`handleStandardProcess` equivalent) posts to `POST /api/upload` with
  `file`, `source_system`, `transaction_date`, and `template` = the selected template key.
- Remove the template-mapping UI and its wiring:
  - Delete/stop rendering `MappingReviewTable` and the ERP-output-template drop zone.
  - Remove `handleAnalyzeMapping`, `handleConfirmMapping`, `templateFile`, `suggestions`,
    `posColumns`, `isAnalyzing`, and the `/api/transform/with-template` calls from `page.tsx`.
  - Remove now-unused `SuggestionItem` / `MappingItem` types (or keep the types file tidy).
  - Delete `frontend/components/MappingReviewTable.tsx` if nothing else uses it.
- Keep unchanged: workspace stat cards, Recent Upload panel (select/reprocess/delete), Output
  Preview + Download, notices/errors.
- Recent uploads / reprocess should reflect the New POS template naturally (source label can show
  the template name).

### Tasks

1. Add a `Template` type and fetch `GET /api/templates`; store `templates` + `selectedTemplate`.
2. Rename tabs and mode state to `process` / `template`; update the toggle buttons.
3. Build the template list component/section in the top card for the Template tab.
4. Implement the hide-bottom-card + expand-top-card layout for the Template tab; verify the
   Recent Upload panel height stays aligned via the existing `ResizeObserver` logic.
5. Show the active template name on the Process tab (badge or summary line).
6. Send `template` in the `/api/upload` form data.
7. Remove the template-file drop zone, mapping analysis, mapping confirm, and `MappingReviewTable`.
8. Clean up unused state, handlers, types, and the `MappingReviewTable.tsx` file.
9. Verify end-to-end: select New POS Template → Process tab → upload sample → preview + download
   match the worked example.

### Expected Output

- Updated `frontend/app/page.tsx` — Process/Template tabs, template list, template-aware upload.
- Updated `frontend/types/index.ts` — add `Template`; drop unused mapping types.
- Possibly a small `frontend/components/TemplateList.tsx` for the selection list.
- Removed `frontend/components/MappingReviewTable.tsx` (and template drop zone usage).

### Acceptance Criteria

- [ ] The tabs read `Process` and `Template`.
- [ ] The Template tab lists `Old POS Template` and `New POS Template`; the active one is marked.
- [ ] On the Template tab, the process card is hidden and the top card fills the freed height with
      no visible gap; the Recent Upload panel height still lines up.
- [ ] On the Process tab, the upload area and the process button are visible, and the active
      template name is shown.
- [ ] Selecting New POS Template, then uploading `docs/Template/expectedInput.xlsx` on the Process
      tab, produces the worked-example output (matching `docs/Template/expectedOutput.xlsx`) in the
      preview and the downloaded file.
- [ ] Selecting Old POS Template preserves the current standard output exactly.
- [ ] No template file drop zone, mapping suggestion request, or mapping review table remains.
- [ ] Recent Upload select / reprocess / delete and Output Preview / Download still work.

---

## Cross-Cutting Notes

### Architecture Decisions

- **Two transformers, one pipeline.** `DataTransformer` (Old POS) and `NewPosTransformer`
  (New POS) both return `TransformResult`, so the upload endpoint, `FileWriter`, preview, history,
  and reprocess stay generic. Only transformer selection and writer column sets vary by template.
- **Template registry is the single source of truth.** The UI reads templates from
  `GET /api/templates`; the backend selects the transformer from the same registry.
- **New POS constants live in code.** Product Code, Doc Class, Currency, the payment-method
  mapping, and the Doc prefix (`RR1`) are code-defined. Default Settings stays bound to Old POS.

### Data Migration

- `uploads.template` is added via a guarded `ALTER TABLE` in `init_db`; existing rows default to
  `old_pos`. No destructive migration.

### Breaking Changes

- The manual template-mapping flow (`/api/transform/with-template`, `MappingReviewTable`,
  template-file drop zone, `SuggestionItem` / `MappingItem`) is removed. This is intentional and
  replaces Phase 4 "Template Mode" from `docs/PHASE.md`.
- `POST /api/upload` gains an optional `template` field; callers omitting it are unaffected.

### Assumptions To Confirm (see docs/REVISION_CONTEXT.md)

- Customer Code follows the per-payment-method mapping (`72 / 68 / 70 / 71 / 69`) and is written
  as a number (leading zeros dropped). Switch to padded text only if the ERP requires it.
- New POS business dates are `MM/DD/YYYY`; SI Number date suffix is `MMDD`.
- Product Code `001` is stored as-is (renders as `1` numerically in Excel).

### Testing / Verification

- Phase 1: unit-test `NewPosTransformer` against `docs/Template/expectedInput.xlsx` and
  `docs/Template/expectedOutput.xlsx`.
- Phase 2: verify `/api/templates`, template-aware upload + reprocess, and the DB migration on a
  copy of an existing `db.sqlite3`.
- Phase 3: manual end-to-end on both templates; confirm the Template-tab layout and that Old POS
  output is unchanged.
- Docs: update `docs/PHASE.md` / `docs/SYSTEM_OVERVIEW.md` to reflect the template list replacing
  Template Mode once all phases land.
