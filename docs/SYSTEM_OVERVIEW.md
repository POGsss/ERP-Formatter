# SYSTEM OVERVIEW
## ERP Excel Formatter — POS-to-ERP Middleware

---

## Purpose

A lightweight internal web application that automates the reformatting of raw POS export files
into ERP-ready import files. The system reads a POS daily export, applies a fixed column mapping
to the ERP's 18-column import template, and produces a downloadable `.xlsx` file that accounting
can import directly — no manual column remapping inside the ERP required.

---

## The Problem It Solves

```
BEFORE (manual):
  Cashier exports POS daily summary
    → sends raw file to accounting
      → accounting opens ERP
        → uploads file
          → manually remaps every column inside ERP
            → fixes formats, fills in constants
              → submits and hopes it doesn't error

AFTER (automated):
  Cashier uploads POS file to web app
    → system applies fixed mapping automatically
      → accounting downloads ERP-ready file
        → imports directly — zero remapping needed
```

---

## Who Uses It

| Role | What they do in this system |
|---|---|
| Cashier / POS Staff | Uploads the raw daily POS export |
| Accounting | Reviews the output preview and downloads the formatted ERP file |
| Admin | Manages system settings, views upload history |

---

## Fixed ERP Output Template

The system always produces a file with exactly these 18 columns in this order.
This is the format the ERP accepts for import.

| # | Column | Type | Default if unmappable |
|---|---|---|---|
| 1 | Customer | String | `NA` |
| 2 | Product | String/Int | `NA` |
| 3 | Quantity | Number | `1` |
| 4 | Price | Number | `0` |
| 5 | Date | Date (MM/DD/YYYY) | today's date |
| 6 | Doc Class | String | `NA` |
| 7 | Customer Code | String/Int | `NA` |
| 8 | Product Name | String | `NA` |
| 9 | Account Type | String | `NA` |
| 10 | Total Amount | Number | `0` |
| 11 | Vat Payable | Number | `0` |
| 12 | Bank Code | String/Int | `NA` |
| 13 | Remarks | String | `NA` |
| 14 | SI Number | String | `NA` |
| 15 | Order Number | String | `NA` |
| 16 | Class | Int | `0` |
| 17 | Order Date | Date (MM/DD/YYYY) | `NA` |
| 18 | Active | Int | `1` |

---

## Mosaic POS → ERP Column Mapping

Based on analysis of the actual POS export file (Mosaic POS v1.5, NUTRIZONE FOOD CORP.)
and the ERP output template. All formulas are verified against real sample data.

### Confirmed Mappings

| ERP Column | Source | Formula / Value | Notes |
|---|---|---|---|
| **Date** | POS: `Date` | Direct copy | Reformat to `MM/DD/YYYY` if needed |
| **Total Amount** | POS: `Gross Sales` | Direct copy, strip commas | `Gross Sales = Net Sales + VAT + Discounts + VAT Adjustment` — the full top-line daily revenue |
| **Vat Payable** | POS: `VAT` | Direct copy, strip commas | The VAT column maps directly |
| **Price** | POS: `Net Sales` | Direct copy, strip commas | Net revenue before VAT — best representation of unit price for a daily batch |
| **Quantity** | Hardcoded | `1` | Each row is a daily summary batch, not individual items |
| **Remarks** | POS: `Remarks` | Direct copy | Will be blank/NA on most days |

### Formula Verification (from sample data)

```
POS values from sample:
  Net Sales:         22,616.73
  Gross Sales:       27,394.97
  VATABLE Sales:     21,806.72
  VAT:                2,616.90
  VAT Exempt Sales:     810.01
  Zero Rated Sales:       0.00
  Discount PWD:         156.06
  Discount Senior:       46.42
  Discount Other:     1,837.35
  VAT Adjustment:       121.51

Verified:
  Net Sales = VATABLE Sales + VAT Exempt Sales + Zero Rated Sales
  22,616.73 = 21,806.72 + 810.01 + 0.00  ✓

  Gross Sales = Net Sales + VAT + Discounts + VAT Adjustment
  27,394.97 = 22,616.73 + 2,616.90 + 156.06 + 46.42 + 1,837.35 + 121.51  ✓

  Therefore:
    Total Amount → Gross Sales  (full revenue including VAT and adjustments)
    Price        → Net Sales    (revenue before VAT)
    Vat Payable  → VAT          (direct)
    Quantity     → 1            (daily batch = 1 unit)
```

### Unmappable Columns (require ERP lookup data — default to NA/0)

These columns exist in the ERP template but have no equivalent in the POS export.
They require ERP-specific codes (customer IDs, product codes, etc.) that only exist
inside the ERP itself. Once ERP access is obtained, these can be configured as
hardcoded constants or lookup tables per source system.

| ERP Column | Default | Why unmappable now |
|---|---|---|
| Customer | `NA` | ERP customer name (e.g. "PAYMAYA") — not in POS export |
| Product | `NA` | ERP internal product code (e.g. 1023) — not in POS |
| Doc Class | `NA` | ERP document classification code (e.g. "K1") — not in POS |
| Customer Code | `NA` | ERP numeric customer ID (e.g. 214) — not in POS |
| Product Name | `NA` | ERP product display name — not in POS |
| Account Type | `NA` | ERP account type label (e.g. "CARD") — not in POS |
| Bank Code | `NA` | ERP bank/payment method code (e.g. 4) — not in POS |
| SI Number | `NA` | ERP-generated invoice number (e.g. "K1-MYC001218") — not in POS |
| Order Number | `NA` | NaN in sample — likely optional or ERP-generated |
| Class | `0` | ERP enum value — not in POS |
| Order Date | `NA` | NaN in sample — may be same as Date, confirm with ERP |
| Active | `1` | Hardcoded default — all imported records should be active |

---

## Core Features

### 1. File Upload
- Single file upload: `.xlsx`, `.xls`, or `.csv`
- Auto-detects and skips the Mosaic POS metadata header block (rows 0–8)
- Transaction date picker (defaults to today)
- Source system label (for audit trail)

### 2. Transformation Engine (Python core)
- Reads the POS file regardless of metadata header depth
- Applies the fixed 18-column ERP mapping
- Strips commas from number fields, normalizes date format
- Fills unmappable columns with `NA` (strings) or `0` (numbers) or `1` (Active)
- Validates all mandatory columns are present before writing output

### 3. Preview & Download
- Accounting sees a preview table of all 18 output columns before downloading
- Unmapped/defaulted columns are visually highlighted so accounting knows what needs
  manual attention after ERP import
- One-click download of the formatted `.xlsx` file

### 4. Optional: Template Upload Mode
- Advanced mode (toggle in settings): user can upload a custom output template
  alongside the POS file
- System compares the template's column names against the POS export and
  auto-suggests mappings using fuzzy matching
- Allows the system to handle other source systems beyond Mosaic POS in the future
- Default mode (no template upload) always uses the fixed 18-column ERP mapping above

### 5. Audit Log
- Every upload and transformation is logged
- Records: timestamp, filename, source system, rows processed, errors, output file

---

## Tech Stack

| Layer | Technology | Reason |
|---|---|---|
| Backend | Python + FastAPI | Lightweight, async, native pandas/openpyxl integration |
| Transformation | pandas + openpyxl + xlrd | Industry standard for Excel in Python |
| Frontend | Next.js 14 (App Router) + Tailwind CSS | Consistent with ARCH V2 stack |
| Database | SQLite (dev) → PostgreSQL (prod) | Audit logs and upload history |
| File Storage | Local filesystem (`/uploads`, `/outputs`) | Internal tool, no cloud needed initially |
| Auth | JWT (FastAPI + bcrypt) | Role separation: cashier / accounting / admin |

---

## Data Flow

```
[Cashier] uploads POS .xlsx
        │
        ▼
[Upload Portal]
  • Validate file type + size
  • Detect and skip metadata header (rows 0–8)
  • Read data starting from row 9
        │
        ▼
[Transformation Engine]
  • Apply fixed 18-column ERP mapping:
      Date        ← POS Date (reformat)
      Total Amount← POS Gross Sales (strip commas)
      Vat Payable ← POS VAT (strip commas)
      Price       ← POS Net Sales (strip commas)
      Quantity    ← hardcoded: 1
      Remarks     ← POS Remarks
      [12 others] ← NA or 0 (pending ERP access)
  • Validate mandatory fields
        │
        ├─── errors? ──→ [Error Report .xlsx]
        │
        ▼
[Output File: 18-column ERP-ready .xlsx]
        │
        ▼
[Accounting] downloads → imports to ERP directly
        │
        ▼
[Audit Log saved to DB]
```

---

## Constraints & Assumptions

- The POS export is always from Mosaic POS v1.5 with the same 24-column structure
  (until other source systems are added via the optional template mode)
- The metadata header in the POS file is always 8 rows before the data header (row 9)
- The ERP import is triggered manually by accounting — the system does not connect to the ERP
- Unmappable columns output `NA` or `0` as defaults; accounting fills in ERP-specific
  values manually inside the ERP after import, OR once ERP access is granted, these
  can be configured as constants in the system settings
- Files are temporary; outputs can be deleted after 30 days

---

## Future Enhancements (post-ERP access)

Once ERP access is obtained, the following can be added without changing the architecture:

1. **Constant value configuration** — Admin sets `Customer = "PAYMAYA"`, `Doc Class = "K1"`, etc.
   per source system in the settings panel, replacing the NA defaults
2. **Lookup tables** — Map POS payment method codes to ERP customer codes
3. **SI Number generation** — Auto-generate from Doc Class prefix + sequential counter
4. **Multi-source system support** — Configure mappings for inventory, payroll, etc.
5. **Direct ERP API integration** — If the ERP exposes an API, skip the download step entirely

---

*Last updated: June 2026*
*Project: ERP Excel Formatter Middleware*
