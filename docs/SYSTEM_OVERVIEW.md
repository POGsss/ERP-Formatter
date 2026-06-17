# SYSTEM OVERVIEW
## ERP Excel Formatter — POS-to-ERP Middleware

---

## Purpose

A lightweight internal web application that automates the reformatting of raw POS export files
into ERP-ready import files. The system reads a POS daily export, applies a fixed column mapping
to the FACT ERP.NG Sale Invoice 11-column import template, and produces a downloadable `.xlsx` file that accounting
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

The system always produces a file with exactly these 11 columns in this order.
This is the FACT ERP.NG Sale Invoice import format.

| # | Column | Type | Required? | Default / Formula |
|---|---|---|---|---|
| 1 | SI Number | String | Required | POS `Date` formatted as `DDMMYYYY` (example: `05/01/2026` -> `05012026`) |
| 2 | Invoice Date | Date | Required | POS `Date` |
| 3 | Product Code | String | Required | `NA` unless set in admin defaults |
| 4 | Quantity | Int | Required | `1` |
| 5 | Unit Price | Number | Required | POS `Net Sales`; blank/invalid values become `0` and are reported as errors |
| 6 | Amount | Number | Required | `VATABLE Sales + VAT Exempt Sales - Discount PWD - Discount Other` |
| 7 | Term Amount | Number | Required | `VAT + VAT Adjustment` |
| 8 | Customer Code | String | Required | `NA` unless set in admin defaults |
| 9 | Doc Class | String | Required | `NA` unless set in admin defaults |
| 10 | Currency Code | String | Required | `PHP` |
| 11 | Remarks | String | Optional | POS `Remarks` |

---

## Mosaic POS → ERP Column Mapping

Based on analysis of the actual POS export file (Mosaic POS v1.5, NUTRIZONE FOOD CORP.)
and the ERP output template. All formulas are verified against real sample data.

### Confirmed Mappings

| ERP Column | Source | Formula / Value | Notes |
|---|---|---|---|
| **SI Number** | POS: `Date` | Format as `DDMMYYYY` without separators | Example: `05/01/2026` -> `05012026`; no Doc Class or invoice-number prefix |
| **Invoice Date** | POS: `Date` | Direct copy, normalized as a date string | Used as the source for SI Number generation |
| **Unit Price** | POS: `Net Sales` | Strip commas, cast to number | Required; blank/invalid values become `0` and are reported as errors |
| **Amount** | POS formula | `VATABLE Sales + VAT Exempt Sales - Discount PWD - Discount Other` | Net taxable/exempt amount after selected discounts |
| **Term Amount** | POS formula | `VAT + VAT Adjustment` | VAT amount due for the sale invoice terms |
| **Quantity** | Admin default | `1` | Each row is a daily summary batch, not individual items |
| **Remarks** | POS: `Remarks` | Direct copy | Optional free-text remarks |

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
  SI Number = POS Date as DDMMYYYY
  05/01/2026 -> 05012026

  Amount = VATABLE Sales + VAT Exempt Sales - Discount PWD - Discount Other
  20,623.32 = 21,806.72 + 810.01 - 156.06 - 1,837.35

  Term Amount = VAT + VAT Adjustment
  2,738.41 = 2,616.90 + 121.51

  Therefore:
    SI Number   -> DDMMYYYY from POS Date
    Unit Price  -> Net Sales
    Amount      -> calculated sales amount
    Term Amount -> VAT + VAT Adjustment
    Quantity    -> 1 (daily batch = 1 unit)
```

### ERP Setup / Admin Defaults Mapping

All 11 output columns are configurable in Admin Settings. Formula rows use native POS
logic by default; changing the type to `string`, `int`, `float`, or `date` overrides
the formula with a fixed accounting value and records "Overridden in admin settings"
in the Column Summary sheet.

| ERP Column | Default Value | Value Type | Description |
|---|---|---|---|
| SI Number | `(generated from date)` | formula | Auto-generated as DDMMYYYY from Invoice Date |
| Invoice Date | `(from POS Date)` | date | Direct from POS Date column |
| Product Code | `NA` | string | ERP internal product code - set this once |
| Quantity | `1` | int | Daily batch = 1 unit always |
| Unit Price | `(from POS Net Sales)` | formula | POS Net Sales column |
| Amount | `(formula)` | formula | VATABLE Sales + VAT Exempt - Discount PWD - Discount Other |
| Term Amount | `(formula)` | formula | VAT + VAT Adjustment |
| Customer Code | `NA` | string | ERP customer ID - set this once |
| Doc Class | `NA` | string | ERP document class code - set this once |
| Currency Code | `PHP` | string | Always PHP for POS transactions |
| Remarks | `(from POS Remarks)` | string | Direct from POS Remarks column |

---

## Core Features

### 1. File Upload
- Single file upload: `.xlsx`, `.xls`, or `.csv`
- Auto-detects and skips the Mosaic POS metadata header block (rows 0–8)
- Transaction date picker (defaults to today)
- Source system label (for audit trail)

### 2. Transformation Engine (Python core)
- Reads the POS file regardless of metadata header depth
- Applies the fixed 11-column FACT ERP.NG Sale Invoice mapping
- Generates SI Number as `DDMMYYYY` from POS `Date`
- Computes Amount and Term Amount from POS sales/VAT columns
- Treats Unit Price as required; blanks become `0` and are reported as errors
- Applies admin overrides for all 11 columns at runtime

### 3. Preview & Download
- Accounting sees a preview table of all 11 output columns before downloading
- Admin-overridden/defaulted columns are visually highlighted so accounting knows what needs
  manual attention after ERP import
- One-click download of the formatted `.xlsx` file

### 4. Optional: Template Upload Mode
- Advanced mode (toggle in settings): user can upload a custom output template
  alongside the POS file
- System compares the template's column names against the POS export and
  auto-suggests mappings using fuzzy matching
- Allows the system to handle other source systems beyond Mosaic POS in the future
- Default mode (no template upload) always uses the fixed 11-column Sale Invoice mapping above

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
  • Apply fixed 11-column Sale Invoice mapping:
      SI Number    <- POS Date formatted DDMMYYYY
      Invoice Date <- POS Date
      Unit Price   <- POS Net Sales
      Amount       <- VATABLE Sales + VAT Exempt - Discount PWD - Discount Other
      Term Amount  <- VAT + VAT Adjustment
      Quantity     <- admin default 1
      Product/Customer/Doc/Currency defaults <- admin settings
      Remarks      <- POS Remarks
  • Apply admin overrides where value_type is string/int/float/date
        │
        ├─── errors? ──→ [Error Report .xlsx]
        │
        ▼
[Output File: 11-column ERP-ready .xlsx]
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
- All 11 output columns can be reviewed and overridden in Admin Settings.
- Formula defaults run native POS logic; fixed string/int/float/date defaults override that logic.
- Files are temporary; outputs can be deleted after 30 days

---

## Future Enhancements (post-ERP access)

Once ERP access is obtained, the following can be added without changing the architecture:

1. **Branch/source profiles** — Admin stores different Product Code, Customer Code, Doc Class,
   and Currency Code defaults per source system
2. **Lookup tables** — Map POS payment method codes to ERP customer codes
3. **Approval workflow** — Accounting reviews admin overrides before import
4. **Multi-source system support** — Configure mappings for inventory, payroll, etc.
5. **Direct ERP API integration** — If the ERP exposes an API, skip the download step entirely

---

*Last updated: June 2026*
*Project: ERP Excel Formatter Middleware*
