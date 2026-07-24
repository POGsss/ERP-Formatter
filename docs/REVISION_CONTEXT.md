# REVISION_CONTEXT.md

### ERP Formatter Revision — Template List + New POS Template

Source: Assessment of `backend/routers/upload.py`, `backend/routers/template_mode.py`,
`backend/routers/admin.py`, `backend/services/transformer.py`, `backend/services/file_reader.py`,
`backend/services/file_writer.py`, `backend/database.py`, `frontend/app/page.tsx`,
`frontend/components/*`, and `frontend/types/index.ts`.

---

## Current Assessment

### What Exists

| Module | Status | Notes |
| :--- | :--- | :--- |
| Standard upload | ✅ Implemented | `POST /api/upload` reads a Mosaic POS file, runs `DataTransformer`, writes a fixed 12-column FACT ERP.NG workbook, stores history, returns preview + download link. |
| Template Mode | ✅ Implemented (to be removed) | `POST /api/transform/with-template` accepts a POS file **and** an ERP template file, fuzzy-matches template columns to POS columns, returns suggestions, then processes a user-confirmed mapping. Backed by `MappingReviewTable`, `SuggestionItem`, `MappingItem`. |
| Home UI tabs | ✅ Implemented | `frontend/app/page.tsx` toggles between `standard` and `template` modes. Top card = upload form (mode toggle + drop zones). Bottom card = `UploadSummaryPanel` with the "Process" / "Analyze Mapping" button. |
| Reprocess / Delete | ✅ Implemented | `POST /api/admin/uploads/{id}/reprocess` re-runs the standard transformer on the stored source file. Delete removes DB rows and files. |
| Default Settings | ✅ Implemented | Admin-configurable defaults for the 12 standard output columns, stored in `column_defaults`. |

### Core Problems / Goals

1. **Template mapping is manual and heavy.** Uploading a template file and confirming a fuzzy
   column mapping every time is unnecessary. The real need is a small set of known, fixed output
   formats that the user simply picks.
2. **No preset template selection.** There is no way to choose a named transformation. The
   standard transformer is the only "template" and it is implicit.
3. **A second POS export format is needed.** A new payment-method breakdown export (grouped by
   Business Date and Store) must be converted into one ERP row per payment method, with a fixed
   payment-method-to-customer mapping and a different 11-column output schema.
4. **Tab layout mismatch.** The current "Standard / Template" tabs and the always-visible
   process/analyze card do not fit a selection-based workflow.

### Target Experience

**Pick a template once → upload a POS file → process → preview → download.**

- The **Template** tab shows a simple list of named templates. No file upload, no fuzzy mapping,
  no mapping review table.
- The **Process** tab keeps the POS file upload and the process button.
- Selecting **New POS Template** transforms the payment-method breakdown export into per-payment
  ERP rows automatically.

---

## The Two Templates

### Old POS Template (base / default)

- Identical to the current standard transformation (`DataTransformer`).
- Produces the existing 12 columns: SI Number, Invoice Date, Product Code, Quantity, Unit Price,
  Amount, Term Amount, Term Code, Customer Code, Doc Class, Currency Code, Remarks.
- Default selection on first load. No behavior change.
- Remains bound to the Default Settings screen.

### New POS Template

Reads a payment-method breakdown export and emits one ERP row per payment method.

Sample files: `docs/Template/expectedInput.xlsx` (input) and
`docs/Template/expectedOutput.xlsx` (expected output).

**Input columns:** `Business Date`, `Store`, `Payment Method`, `Gross Sale`, `VAT Amount`,
`Gross Sale w/o VAT`, `Discount Amount`, `Net Sale`.

Business Date and Store appear only on the first row of each group and are blank on the following
payment-method rows (fill-down required). Each group ends with a bold "…Total" row that must be
skipped.

**Output columns (11, in this exact order):**
`SI Number`, `Invoice Date`, `Product Code`, `Quantity`, `Amount`, `Sales Discount`,
`VAT Payable`, `Customer Code`, `Doc Class`, `Currency Code`, `Remarks`.

**Field mapping:**

| Output column | Rule |
| :--- | :--- |
| SI Number | `"RR1"` + Customer letter + Business Date `MMDD` (e.g. `09/07/2026` + `Card(DEBIT)` → `RR1M0907`) |
| Invoice Date | Business Date (written as a real Excel date) |
| Product Code | Fixed `001` |
| Quantity | Fixed `0` |
| Amount | `Gross Sale w/o VAT` (numeric, strip currency symbol/commas) |
| Sales Discount | `Discount Amount` (numeric) |
| VAT Payable | `VAT Amount` (numeric) |
| Customer Code | Per payment method (see mapping below) |
| Doc Class | Fixed `RR1` |
| Currency Code | Fixed `PHP` |
| Remarks | Empty (no default) |

**Payment method mapping (authoritative — Customer Code varies per payment method):**

| Payment Method | Customer | Customer Code | Customer letter (SI Number) |
| :--- | :--- | :--- | :--- |
| Card(DEBIT) | MAYA QR | 72 | M |
| Card(MASTER) | MAYA QR | 72 | M |
| cash | CASH - UNIOILTAYTAY | 68 | C |
| Other( E-Wallet ) | MAYA QR | 72 | M |
| Other( FoodPanda ) | FOOD PANDA | 70 | F |
| Other( GrabFood ) | GRAB FOOD | 71 | G |
| Other( Pickup Coffee App ) | BARISTA APP | 69 | B |

Payment methods are matched case-insensitively and whitespace-normalized.

**Worked example** (Business Date `09/07/2026`, Store `UNIOIL DIVERSION ROAD TAYTAY`):

| SI Number | Invoice Date | Product Code | Quantity | Amount | Sales Discount | VAT Payable | Customer Code | Doc Class | Currency Code | Remarks |
| :--- | :--- | :--- | :--- | :--- | :--- | :--- | :--- | :--- | :--- | :--- |
| RR1M0907 | 9/7/2026 | 001 | 0 | 280.35 | 0 | 33.65 | 72 | RR1 | PHP | |
| RR1M0907 | 9/7/2026 | 001 | 0 | 111.61 | 0 | 13.39 | 72 | RR1 | PHP | |
| RR1C0907 | 9/7/2026 | 001 | 0 | 10550.83 | 62.14 | 1228.88 | 68 | RR1 | PHP | |
| RR1M0907 | 9/7/2026 | 001 | 0 | 2972.31 | 0 | 356.69 | 72 | RR1 | PHP | |
| RR1F0907 | 9/7/2026 | 001 | 0 | 1772.35 | 0 | 212.65 | 70 | RR1 | PHP | |
| RR1G0907 | 9/7/2026 | 001 | 0 | 660.72 | 0 | 79.28 | 71 | RR1 | PHP | |
| RR1B0907 | 9/7/2026 | 001 | 0 | 3224.17 | 559.2 | 319.83 | 69 | RR1 | PHP | |

> The Total row (`UNIOIL DIVERSION ROAD TAYTAY Total`) is skipped and does not produce output.

---

## Open Questions / Assumptions

1. **Customer Code = per payment method.** Use the mapping table above (72 / 68 / 70 / 71 / 69).
   The MAYA QR code `72` covers Card(DEBIT), Card(MASTER), and Other( E-Wallet ); cash is `68`;
   FoodPanda `70`; GrabFood `71`; Pickup Coffee App `69`.
2. **Customer Code is written as a number** (leading zeros dropped: `0072` → `72`), matching the
   expected output sample. If the ERP later requires the padded string form (`0072`), switch the
   Customer Code column to text output — this is a one-line change and does not affect the mapping.
3. **Business Date format.** New POS business dates are interpreted as `MM/DD/YYYY` (so
   `09/07/2026` is September 7, 2026, and Excel renders it `9/7/2026`). The SI Number date suffix
   is the two-digit month followed by the two-digit day (`MMDD` → `0907`). Confirm if any branch
   exports use `DD/MM/YYYY`.
4. **Product Code `001`.** Stored as the value `001`; the expected sample renders it as `1`
   because Excel treats it numerically. Keep as-is unless the ERP needs the padded text `001`.
5. **New POS constants are code-defined**, not part of Default Settings. Default Settings stays
   bound to the Old POS Template only.

---

## Cross-Cutting Notes

### Build Order

- **Phase 1** (New POS transformation engine) is independent and can be built and unit-tested
  first against `docs/Template/expectedInput.xlsx` and `docs/Template/expectedOutput.xlsx`.
- **Phase 2** (template registry, DB migration, template-aware processing, reprocess) depends on
  Phase 1's transformer existing.
- **Phase 3** (Template list + Process/Template tab UI) depends on Phase 2's `template` request
  parameter and `/api/templates` endpoint.
- Suggested order: Phase 1 → Phase 2 → Phase 3.

### Removals

- Delete the manual template-file upload + fuzzy mapping flow from the UI:
  `MappingReviewTable`, the template drop zone, `SuggestionItem`/`MappingItem` usage in the page,
  and the "Analyze Mapping" action.
- The `POST /api/transform/with-template` endpoint and `template_mode.py` are no longer used by
  the UI. Keep or delete per Phase 2 guidance (recommended: remove after Phase 3 lands).

### Data Migration

- Add a `template` (or `template_key`) column to the `uploads` table with a default of the Old POS
  Template. Existing rows must migrate cleanly (SQLite `ALTER TABLE ... ADD COLUMN` guarded by a
  column-existence check in `init_db`).

### Backward Compatibility

- `POST /api/upload` without a `template` value must still behave exactly like today (Old POS).
- Reprocess must reuse the template recorded on the original upload.
- The standard 12-column output and Default Settings must not change.

### Output Writer

- `FileWriter` currently hardcodes standard number/date column names. It must support the New POS
  column set (numeric: Amount, Sales Discount, VAT Payable, Quantity, Product Code; date: Invoice
  Date) without breaking the standard output. Prefer passing the numeric/date column sets into
  `write()` rather than globally editing the module constants.
