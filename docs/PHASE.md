# DEVELOPMENT PHASES
## ERP Excel Formatter — POS-to-ERP Middleware

---

## Phase Overview

```
PHASE 1 → Core Architecture & Project Setup
PHASE 2 → Transformation Engine (Python Core)
PHASE 3 → Web Application (FastAPI + Next.js)
PHASE 4 → Optional Template Upload Mode
PHASE 5 → Admin Panel & Audit Log
PHASE 6 → Hardening & Deployment
```

> Each module below is a complete, self-contained prompt you can paste directly
> to your coding agent. Complete all modules in a phase before starting the next.
> Phases 1–3 produce a fully working product. Phases 4–6 are enhancements.

---

---

# PHASE 1: Core Architecture

---

## Module 1.1: Project Setup & Configuration

### Overview
Initialize the full monorepo structure for both the Python backend (FastAPI) and the
Next.js frontend. Set up environment config, folder conventions, and verify both services
start correctly. All future modules build on this scaffold.

### Requirements
- Python 3.11+ with FastAPI, pandas, openpyxl, xlrd
- Node.js 18+ with Next.js 14 (App Router) and Tailwind CSS
- SQLite for local development (no external DB setup needed)
- `.env` file for all environment config — no hardcoded paths or values
- Git-ready with `.gitignore` covering `.env`, `uploads/`, `outputs/`, `*.sqlite3`

### User Stories
- As a developer, I want a clean project scaffold so I can build features without
  fighting folder structure or config issues.
- As a developer, I want all paths and limits in one `.env` file so changes are
  made in one place.

### Task
```
Create a monorepo project named `erp-formatter` with this exact folder structure:

erp-formatter/
├── backend/
│   ├── main.py                   # FastAPI app entry point
│   ├── config.py                 # Loads .env, exposes typed constants
│   ├── database.py               # SQLite init, creates tables on startup
│   ├── requirements.txt
│   ├── .env.example
│   ├── routers/                  # Empty — populated in later modules
│   └── services/                 # Empty — populated in later modules
│
├── frontend/
│   ├── package.json
│   ├── next.config.js
│   ├── tailwind.config.js
│   └── app/
│       ├── layout.tsx            # Root layout with nav placeholder
│       └── page.tsx              # Placeholder: "ERP Formatter — coming soon"
│
├── uploads/                      # Runtime: uploaded POS files (git-ignored)
├── outputs/                      # Runtime: generated ERP files (git-ignored)
└── README.md

--- backend/requirements.txt ---
fastapi
uvicorn
python-multipart
pandas
openpyxl
xlrd
python-dotenv
aiofiles
bcrypt
python-jose[cryptography]

--- backend/.env.example ---
UPLOAD_DIR=./uploads
OUTPUT_DIR=./outputs
DATABASE_URL=./db.sqlite3
MAX_FILE_SIZE_MB=10
ALLOWED_EXTENSIONS=xlsx,xls,csv
SECRET_KEY=changeme-replace-in-production
ACCESS_TOKEN_EXPIRE_HOURS=24

--- backend/config.py ---
Load all values from .env using python-dotenv.
Expose them as typed module-level constants:
  UPLOAD_DIR: str
  OUTPUT_DIR: str
  DATABASE_URL: str
  MAX_FILE_SIZE_MB: int
  ALLOWED_EXTENSIONS: list[str]   # split the comma-separated string
  SECRET_KEY: str
  ACCESS_TOKEN_EXPIRE_HOURS: int

On import, create UPLOAD_DIR and OUTPUT_DIR directories if they don't exist.

--- backend/main.py ---
Create a FastAPI app with:
  - A lifespan event that calls init_db() on startup
  - GET /health → returns { "status": "ok", "service": "erp-formatter" }
  - CORS middleware allowing all origins (internal tool — tighten later)
  - Include an empty APIRouter from routers/ (add routes in later modules)
```

### Expected Output
- `cd backend && uvicorn main:app --reload` starts without errors
- `GET http://localhost:8000/health` returns `{ "status": "ok" }`
- `cd frontend && npm run dev` starts without errors
- `http://localhost:3000` shows the placeholder page
- `uploads/` and `outputs/` directories are created automatically on backend start

### Acceptance Criteria
- [ ] Backend starts without errors
- [ ] `/health` returns HTTP 200 with correct JSON
- [ ] Frontend starts without errors
- [ ] Config loads from `.env.example` correctly (rename to `.env` to test)
- [ ] `.env` and runtime dirs are in `.gitignore`

---

## Module 1.2: Database Schema

### Overview
Define and initialize the SQLite schema for upload history and audit logs. Runs once on
startup and creates all tables idempotently. Designed with standard SQL types so it
can be migrated to PostgreSQL in production without changes.

### Requirements
- All tables created with `CREATE TABLE IF NOT EXISTS`
- Use Python's built-in `sqlite3` — no ORM needed at this stage
- `init_db()` called from FastAPI lifespan in `main.py`

### User Stories
- As a developer, I want tables created automatically on first run with no migration step.
- As accounting, I want every upload logged so I can trace any ERP rejection to
  the exact file and transformation that produced it.

### Task
```
Implement backend/database.py with a single function init_db() that creates:

TABLE: uploads
  id               INTEGER PRIMARY KEY AUTOINCREMENT
  filename         TEXT NOT NULL          -- UUID filename saved to disk
  original_name    TEXT NOT NULL          -- original filename from user
  source_system    TEXT                   -- e.g. "Mosaic POS v1.5 - Branch 1"
  transaction_date TEXT                   -- date the POS data covers
  uploaded_at      TEXT DEFAULT CURRENT_TIMESTAMP
  status           TEXT DEFAULT 'pending' -- pending | processing | done | error
  row_count        INTEGER DEFAULT 0
  error_count      INTEGER DEFAULT 0
  output_file      TEXT                   -- filename of the generated ERP file
  error_report     TEXT                   -- filename of error report, if any
  uploader_ip      TEXT

TABLE: audit_log
  id               INTEGER PRIMARY KEY AUTOINCREMENT
  upload_id        INTEGER REFERENCES uploads(id)
  event            TEXT NOT NULL          -- e.g. "file_read" | "transform" | "write" | "download"
  detail           TEXT                   -- human-readable detail message
  warnings         TEXT                   -- JSON array of warning strings
  errors           TEXT                   -- JSON array of error strings
  created_at       TEXT DEFAULT CURRENT_TIMESTAMP

Also implement these helper functions in database.py:
  get_db() → returns a sqlite3.Connection with row_factory = sqlite3.Row
  insert_upload(conn, data: dict) → int  (returns new upload id)
  update_upload(conn, upload_id: int, data: dict) → None
  insert_audit(conn, data: dict) → None
  get_upload(conn, upload_id: int) → dict | None
  get_recent_uploads(conn, limit: int = 20) → list[dict]
```

### Expected Output
- Running the backend twice creates tables only once (no duplicate table errors)
- `uploads` and `audit_log` tables exist in `db.sqlite3` after first run
- Helper functions work correctly in a quick manual test

### Acceptance Criteria
- [ ] `init_db()` runs without error on first and subsequent startups
- [ ] Both tables exist: verify with `sqlite3 db.sqlite3 .tables`
- [ ] `insert_upload` returns an integer ID
- [ ] `get_db()` returns rows accessible by column name (row_factory set)

---

---

# PHASE 2: Transformation Engine

---

## Module 2.1: File Reader

### Overview
The module that reads any uploaded POS file and returns a clean pandas DataFrame.
Must handle `.xlsx`, `.xls`, `.csv`, detect the metadata header block automatically,
and return both the clean data and extracted metadata.

The Mosaic POS v1.5 file has 8 rows of metadata (POS name, account name, location,
TIN, date range, generated date, generated by) before the actual column header at row 9.
The reader must detect and skip this block without hardcoding row 9 — it should work
even if the metadata block grows or shrinks.

### Requirements
- `.xlsx` → openpyxl engine
- `.xls` → xlrd engine
- `.csv` → pandas native
- Header detection: scan rows 0–20, find first row where ≥ 70% of cells are
  non-empty strings AND the following row has ≥ 50% non-empty cells
- Fall back to row 0 if detection fails
- Strip whitespace from all column names
- Return metadata as key-value dict from rows above the header

### User Stories
- As the system, I want to correctly read any Mosaic POS export regardless of how
  many metadata rows appear before the data.
- As a developer, I want one consistent interface for all three file types.

### Task
```
Create backend/services/file_reader.py

Implement class FileReader with one public method:

  def read(self, filepath: str) -> dict:
    """
    Returns:
    {
      "dataframe": pd.DataFrame,      # clean data with stripped column names
      "header_row_index": int,        # row index where actual header was found
      "metadata": dict,               # key-value from rows above header
                                      # e.g. {"POS": "Mosaic POS v1.5",
                                      #        "Account Name": "NUTRIZONE FOOD CORP.",
                                      #        "Location": "...", "TIN": "...",
                                      #        "From Date": "2026-05-01", ...}
      "row_count": int,               # number of data rows (excluding header)
      "column_names": list[str],      # final column names after strip
      "file_type": str                # "xlsx" | "xls" | "csv"
    }
    """

Header detection algorithm:
  1. Read entire file with header=None (raw mode)
  2. For each row index i from 0 to min(20, total_rows):
     a. Count non-empty cells in row i
     b. Count non-empty cells in row i+1
     c. If row_i_fill >= 0.7 AND row_i+1_fill >= 0.5:
        → header is at row i
        → metadata = rows 0 through i-1
        → data starts at row i+1
        → break
  3. If no row matches, header_row_index = 0, metadata = {}

Metadata parsing (rows above header):
  - For each row above header: column A = key, column B = value
  - Skip rows where both A and B are empty
  - Strip ":" from key names (e.g. "Account Name:" → "Account Name")

Number columns in Mosaic POS have values like "1,374,183.28" stored as strings.
DO NOT auto-convert these here. Return them as-is — the transformer handles cleaning.

Error handling:
  - Unsupported file extension → raise ValueError("Unsupported file type: {ext}")
  - File not found → raise FileNotFoundError
  - Empty file → raise ValueError("File is empty or has no readable data")

Add a standalone test at the bottom (under if __name__ == "__main__":) that:
  1. Reads uploads/input.xlsx and prints: header_row_index, metadata, column_names, row_count
  2. Reads uploads/output.xls and prints: header_row_index, column_names, row_count
```

### Expected Output
- `input.xlsx` → header_row_index=9, metadata with 8 keys, 24 columns, 1 data row
- `output.xls` → header_row_index=0, no metadata, 18 columns, 1 data row
- Column names have no leading/trailing whitespace

### Acceptance Criteria
- [ ] `input.xlsx` header detected at row 9 without hardcoding
- [ ] All 8 metadata fields extracted correctly from `input.xlsx`
- [ ] All 24 POS column names returned cleanly
- [ ] All 3 file types handled without errors
- [ ] Unsupported extension raises descriptive ValueError
- [ ] No `eval()` anywhere in the file

---

## Module 2.2: POS-to-ERP Transformer

### Overview
The core of the system. Takes the clean POS DataFrame from FileReader and produces
a new DataFrame with exactly the 18 ERP output columns, in the correct order, with
correct values. Applies all mapping rules defined in SYSTEM_OVERVIEW.md.

### Requirements
- Output must always have exactly these 18 columns in this exact order:
  `Customer, Product, Quantity, Price, Date, Doc Class, Customer Code,
   Product Name, Account Type, Total Amount, Vat Payable, Bank Code,
   Remarks, SI Number, Order Number, Class, Order Date, Active`
- Mapped columns: Date, Total Amount, Vat Payable, Price, Quantity, Remarks
- Unmappable columns: fill with NA (strings) or 0 (numbers) or 1 (Active)
- Return a result object with the output DataFrame plus warnings list

### User Stories
- As the system, I want to transform any valid Mosaic POS export into the exact
  18-column ERP format without manual intervention.
- As accounting, I want to know which columns were defaulted so I can review them
  before importing to the ERP.

### Task
```
Create backend/services/transformer.py

--- Data classes ---

@dataclass
class TransformResult:
  output_df: pd.DataFrame    # always 18 columns in correct order
  row_count: int
  error_count: int
  warnings: list[str]        # e.g. ["Customer defaulted to NA — configure in settings"]
  errors: list[str]          # e.g. ["Row 2: Gross Sales is empty — Total Amount set to 0"]
  column_summary: list[dict] # one entry per output column:
                             # { "column": str, "source": str, "status": str }
                             # status: "mapped" | "computed" | "hardcoded" | "defaulted"

--- Main class ---

class DataTransformer:
  def transform(self, input_df: pd.DataFrame) -> TransformResult:
    """Apply the fixed Mosaic POS → ERP mapping."""

--- Mapping rules to implement ---

MAPPED COLUMNS (read from POS, clean, write to output):

  Date:
    source: input_df["Date"]
    transform: parse dates flexibly (try MM/DD/YYYY, YYYY-MM-DD, DD/MM/YYYY)
               output as string "MM/DD/YYYY"
    if null/error: use today's date, add warning

  Total Amount:
    source: input_df["Gross Sales"]
    transform: strip_commas_to_float (remove commas, cast to float)
    if null/error: default 0, add error

  Vat Payable:
    source: input_df["VAT"]
    transform: strip_commas_to_float
    if null/error: default 0, add error

  Price:
    source: input_df["Net Sales"]
    transform: strip_commas_to_float
    if null/error: default 0, add error

  Quantity:
    source: hardcoded value 1
    note: each POS row is a daily batch summary = 1 unit
    add to column_summary with status "hardcoded"

  Remarks:
    source: input_df["Remarks"]
    transform: cast to string, strip whitespace
    if null/NaN: use empty string ""
    no warning needed (remarks is optional)

DEFAULTED COLUMNS (not in POS export — fill with defaults):

  Customer      → "NA"   (string)   status: "defaulted"  warn: "Customer defaulted to NA"
  Product       → "NA"   (string)   status: "defaulted"  warn: "Product defaulted to NA"
  Doc Class     → "NA"   (string)   status: "defaulted"  warn: "Doc Class defaulted to NA"
  Customer Code → "NA"   (string)   status: "defaulted"  warn: "Customer Code defaulted to NA"
  Product Name  → "NA"   (string)   status: "defaulted"  warn: "Product Name defaulted to NA"
  Account Type  → "NA"   (string)   status: "defaulted"  warn: "Account Type defaulted to NA"
  Bank Code     → "NA"   (string)   status: "defaulted"  warn: "Bank Code defaulted to NA"
  SI Number     → "NA"   (string)   status: "defaulted"
  Order Number  → "NA"   (string)   status: "defaulted"
  Class         → 0      (int)      status: "defaulted"
  Order Date    → "NA"   (string)   status: "defaulted"
  Active        → 1      (int)      status: "hardcoded"  (always 1, not a warning)

--- Helper functions ---

def strip_commas_to_float(val) -> float:
  """Remove commas from strings like "1,374,183.28" and cast to float.
     Returns 0.0 if val is None, NaN, or unparseable."""

def parse_date_flexible(val) -> str:
  """Try parsing val as a date in multiple formats.
     Return formatted string "MM/DD/YYYY".
     Returns today's date as string if parsing fails."""

--- Build output DataFrame ---

After processing all columns, build output_df with columns in EXACTLY this order:
  ["Customer", "Product", "Quantity", "Price", "Date", "Doc Class",
   "Customer Code", "Product Name", "Account Type", "Total Amount",
   "Vat Payable", "Bank Code", "Remarks", "SI Number", "Order Number",
   "Class", "Order Date", "Active"]

Deduplicate warnings (same warning appearing for multiple rows → show once with count).

Add a standalone test under if __name__ == "__main__": that:
  1. Uses FileReader to read uploads/input.xlsx
  2. Runs DataTransformer().transform(result["dataframe"])
  3. Prints the output_df, column_summary, warnings, and errors
```

### Expected Output
Running the standalone test on `input.xlsx` produces:
- A DataFrame with exactly 18 columns in correct order
- `Total Amount` = 27394.97 (from Gross Sales "27,394.97")
- `Vat Payable` = 2616.90 (from VAT "2,616.90")
- `Price` = 22616.73 (from Net Sales "22,616.73")
- `Quantity` = 1
- `Date` = "05/01/2026"
- `Customer` = "NA", `Product` = "NA", etc.
- Warnings list has 8 entries (one per defaulted column)
- Errors list is empty (all mapped columns have valid data)

### Acceptance Criteria
- [ ] Output always has exactly 18 columns in exactly the specified order
- [ ] `strip_commas_to_float("1,374,183.28")` returns `1374183.28`
- [ ] `strip_commas_to_float(None)` returns `0.0` without raising
- [ ] `parse_date_flexible("2026-05-01")` returns `"05/01/2026"`
- [ ] `parse_date_flexible("05/01/2026")` returns `"05/01/2026"` unchanged
- [ ] All 12 defaulted columns produce correct defaults (NA or 0 or 1)
- [ ] Warnings list is not empty (defaulted columns are reported)
- [ ] `column_summary` has exactly 18 entries, one per output column

---

## Module 2.3: Output File Writer

### Overview
Takes the 18-column output DataFrame from the transformer and writes a formatted
`.xlsx` file to the `outputs/` directory. The file must open correctly in Excel
and be ready for direct ERP import with no formatting changes needed.

Also writes a companion column summary sheet so accounting can see at a glance
which columns were mapped, hardcoded, or defaulted.

### Requirements
- Use `openpyxl` for writing
- Styled header row (bold, blue background, white text)
- Number columns formatted as `#,##0.00`
- Date columns formatted as `MM/DD/YYYY`
- Frozen header row
- Auto-fitted column widths
- Timestamped output filename

### User Stories
- As accounting, I want the output file to open in Excel with correct formatting
  so I can import it to the ERP without any manual cleanup.
- As accounting, I want a summary sheet showing which columns were auto-filled
  vs defaulted so I know what to check.

### Task
```
Create backend/services/file_writer.py

class FileWriter:
  def write(self, result: TransformResult, output_dir: str, template_name: str = "erp-output") -> dict:
    """
    Writes the output Excel file.
    Returns:
    {
      "output_path": str,       # full path to the generated .xlsx file
      "output_filename": str,   # just the filename
      "summary_path": str | None  # path to error report if errors exist
    }
    """

--- Output filename ---
Format: erp_output_{YYYYMMDD_HHMMSS}.xlsx
Example: erp_output_20260601_143022.xlsx

--- Sheet 1: "ERP Import" (the main data sheet) ---

Header row formatting (row 1):
  - Font: bold, white, size 11
  - Fill: solid, color #2E75B6 (blue)
  - Alignment: center horizontal

Data row formatting:
  - Alternating row colors: white (#FFFFFF) and light gray (#F2F2F2)
  - Defaulted columns (NA or 0 default): light yellow fill (#FFFACD) on the cell
    so accounting can spot them easily

Number format (#,##0.00) applied to columns:
  Quantity, Price, Total Amount, Vat Payable, Class, Active

Date format (MM/DD/YYYY as text — these are already strings, just ensure no auto-conversion):
  Date, Order Date

Column widths:
  - Auto-fit: max(len(header), max(len(str(val)) for val in column)) + 4
  - Minimum width: 10
  - Maximum width: 45

Other:
  - Freeze pane at A2 (header always visible)
  - sheet.sheet_view.showGridLines = False

--- Sheet 2: "Column Summary" ---

A second sheet named "Column Summary" with these columns:
  ERP Column | Source | Status | Notes

Populated from TransformResult.column_summary:
  - "mapped"    → green fill (#C6EFCE), "Mapped from POS: {input_col}"
  - "hardcoded" → blue fill (#BDD7EE), "Hardcoded value: {value}"
  - "defaulted" → yellow fill (#FFEB9C), "No POS source — defaulted to {default_value}"

This sheet gives accounting a one-glance audit of what was auto-filled.

--- Error report (only if result.error_count > 0) ---

Write a separate file: erp_errors_{YYYYMMDD_HHMMSS}.xlsx
Columns: Row Number | ERP Column | Error Message | Original POS Value
Red fill (#FFC7CE) on all rows.

Add a standalone test under if __name__ == "__main__": that runs the full pipeline
(FileReader → DataTransformer → FileWriter) on uploads/input.xlsx and prints the output paths.
```

### Expected Output
- `outputs/erp_output_YYYYMMDD_HHMMSS.xlsx` is created
- File has two sheets: "ERP Import" and "Column Summary"
- Defaulted cells are highlighted yellow in the data sheet
- Column Summary sheet shows green/blue/yellow rows correctly

### Acceptance Criteria
- [ ] Output file opens in Excel/LibreOffice without errors or warnings
- [ ] Header row is bold with blue background and white text
- [ ] Two sheets present: "ERP Import" and "Column Summary"
- [ ] Defaulted cells (NA/0 values) have yellow fill
- [ ] Number columns display as `#,##0.00`
- [ ] Error report only created when `error_count > 0`
- [ ] Filename is timestamped in format `erp_output_YYYYMMDD_HHMMSS.xlsx`
- [ ] Full pipeline test runs end-to-end without errors

---

---

# PHASE 3: Web Application

---

## Module 3.1: FastAPI Upload Endpoint

### Overview
The backend API that ties Phases 1 and 2 together into a working web service.
Receives uploaded POS files, runs the full transformation pipeline, saves records
to the DB, and returns the result (including a preview and download URL) as JSON.

### Requirements
- `POST /api/upload` — multipart form, runs full pipeline
- `GET /api/download/{filename}` — serves output files securely
- `GET /api/uploads` — returns recent upload history
- All file operations wrapped in try/except with proper HTTP error responses

### User Stories
- As a cashier, I want to upload my POS file via the web form and get back a
  download link for the formatted ERP file.
- As accounting, I want to see a preview of the transformed data and any warnings
  before downloading.

### Task
```
Create backend/routers/upload.py and register it in main.py with prefix /api

--- POST /api/upload ---

Accept multipart/form-data with fields:
  file:              UploadFile (required)
  source_system:     str (optional, default "Unknown")
  transaction_date:  str (optional, ISO date, default today)

Processing steps:
  1. Validate file extension (must be in ALLOWED_EXTENSIONS from config)
  2. Validate file size (must be ≤ MAX_FILE_SIZE_MB)
     If either fails: return HTTP 400 with { "error": "...", "detail": "..." }
  3. Save file to UPLOAD_DIR with a UUID4 filename (preserve original extension)
  4. Insert record into uploads table with status="processing"
  5. Run pipeline: FileReader → DataTransformer → FileWriter
  6. On success: update uploads record with status="done", output_file, row_count, error_count
  7. On pipeline error: update uploads record with status="error", insert audit log
  8. Insert record into audit_log table
  9. Return JSON response:
     {
       "upload_id": int,
       "status": "done" | "error",
       "original_filename": str,
       "row_count": int,
       "error_count": int,
       "warnings": list[str],
       "errors": list[str],
       "column_summary": list[dict],
       "download_url": "/api/download/{output_filename}",
       "error_report_url": "/api/download/{error_filename}" | null,
       "preview": list[dict]   // first 10 rows of output_df as records
     }

--- GET /api/download/{filename} ---

  Security checks (return 400 if any fail):
    - filename must not contain ".." or "/" or "\"
    - filename must end with ".xlsx" or ".xls" or ".csv"
    - file must exist in OUTPUT_DIR

  If all pass:
    return FileResponse with:
      Content-Disposition: attachment; filename="{filename}"
      media_type: application/vnd.openxmlformats-officedocument.spreadsheetml.sheet

--- GET /api/uploads ---

  Query params:
    limit: int = 20
    offset: int = 0

  Return:
  {
    "uploads": [
      {
        "id": int,
        "original_name": str,
        "source_system": str,
        "transaction_date": str,
        "uploaded_at": str,
        "status": str,
        "row_count": int,
        "error_count": int,
        "download_url": str | null
      }
    ],
    "total": int
  }

All endpoints must handle exceptions and return appropriate HTTP status codes:
  400 → validation errors (wrong file type, too large, etc.)
  404 → file not found for download
  500 → pipeline errors (with error detail in response body)
```

### Expected Output
- `POST /api/upload` with `input.xlsx` returns JSON with preview of 18-column data
- `GET /api/download/{filename}` triggers a file download in the browser
- `GET /api/uploads` returns a list of past uploads

### Acceptance Criteria
- [ ] Upload accepts `.xlsx`, `.xls`, `.csv` only
- [ ] Upload rejects files over `MAX_FILE_SIZE_MB` with HTTP 400
- [ ] Download rejects path traversal (`../etc/passwd`) with HTTP 400
- [ ] DB record is inserted for every upload attempt, including failures
- [ ] Preview contains at most 10 rows
- [ ] `column_summary` is included in response
- [ ] All pipeline errors return HTTP 500 with readable error message

---

## Module 3.2: Next.js Upload Page (Main UI)

### Overview
The primary user-facing page. A cashier uploads their POS file, optionally labels
the source system and date, submits, and sees a preview table with the 18 output
columns highlighted by mapping status. Accounting then downloads the formatted file.

### Requirements
- Responsive (desktop + tablet minimum)
- Drag-and-drop file upload zone
- Source system label input and transaction date picker
- Loading state while backend processes the file
- Preview table with color-coded columns (mapped vs defaulted)
- Column Summary panel showing mapping status per column
- Download buttons for the output file and error report

### User Stories
- As a cashier, I want a simple upload form that gives me clear feedback when
  my file is processed or rejected.
- As accounting, I want to see the 18-column output preview with defaulted cells
  highlighted before I download.

### Task
```
Create the following component files in frontend/components/:

1. DropZone.tsx
   Props: onFileSelect(file: File), maxSizeMB: number, allowedTypes: string[]
   - Accepts drag-and-drop and click-to-browse
   - Shows filename + file size after selection
   - Shows red error message for wrong type or oversized file
   - Green border when valid file is selected
   - Red border when invalid file

2. UploadForm.tsx
   Props: onUploadComplete(result: UploadResult)
   Contains: DropZone, source system text input, date picker, submit button
   - Submit button disabled until a valid file is selected
   - On submit: show loading spinner, POST multipart to /api/upload
   - On success: call onUploadComplete(result)
   - On HTTP error: show error message inline (not alert())

3. PreviewTable.tsx
   Props: preview: Record<string,any>[], columnSummary: ColumnSummaryItem[]
   - Renders a scrollable table of the preview rows
   - Column headers color-coded:
       mapped/computed/hardcoded → blue header (#2E75B6, white text)
       defaulted → yellow header (#FFEB9C, dark text)
   - Defaulted cells (values "NA" or 0 in defaulted columns) → yellow cell background
   - Shows row count above the table: "Showing X of Y rows"

4. ColumnSummaryPanel.tsx
   Props: columnSummary: ColumnSummaryItem[]
   - Compact panel (collapsible) listing all 18 output columns
   - Each row: column name | status badge | source description
   - Status badges:
       "mapped"    → green badge
       "hardcoded" → blue badge
       "defaulted" → yellow badge with ⚠ icon

5. DownloadPanel.tsx
   Props: downloadUrl: string, errorReportUrl: string | null,
          rowCount: number, errorCount: number, warningCount: number
   - Summary line: "✓ {rowCount} rows processed — {warningCount} warnings — {errorCount} errors"
   - Primary button: "Download ERP File" (links to downloadUrl)
   - Secondary button (only if errorReportUrl): "Download Error Report"
   - Buttons styled clearly distinct (primary: blue filled, secondary: outlined)

Create frontend/app/page.tsx as the main page:
  Layout (top to bottom):
    - Header: "ERP Excel Formatter" title + subtitle "Mosaic POS → ERP Import"
    - Section 1: Upload (always visible): UploadForm
    - Section 2: Results (visible after upload completes):
        - ColumnSummaryPanel (collapsed by default)
        - PreviewTable
        - DownloadPanel
    - Footer: note "Defaulted columns (yellow) require manual entry in the ERP after import"

TypeScript types to define in frontend/types/index.ts:
  interface UploadResult {
    upload_id: number
    status: "done" | "error"
    row_count: number
    error_count: number
    warnings: string[]
    errors: string[]
    column_summary: ColumnSummaryItem[]
    download_url: string
    error_report_url: string | null
    preview: Record<string, any>[]
  }
  interface ColumnSummaryItem {
    column: string
    source: string
    status: "mapped" | "hardcoded" | "defaulted" | "computed"
  }
```

### Expected Output
- Visiting `http://localhost:3000` shows the upload form
- Uploading `input.xlsx` shows the preview table with 18 columns, yellow cells on
  defaulted columns, and the download button
- Download button delivers the `.xlsx` file

### Acceptance Criteria
- [ ] Page renders without console errors
- [ ] Submit button is disabled until a valid file is selected
- [ ] Loading spinner shows during upload
- [ ] Preview table appears after successful upload
- [ ] Defaulted columns have yellow headers and yellow cell backgrounds
- [ ] Mapped columns have blue headers
- [ ] Column Summary panel is present and lists all 18 columns with badges
- [ ] Download button triggers file download

---

---

# PHASE 4: Optional Template Upload Mode

---

## Module 4.1: Custom Template Endpoint

### Overview
An optional advanced mode where a user uploads their own output template (e.g., a
blank ERP import file with different columns) alongside the POS file. The system
compares the template's columns against the POS columns and auto-suggests mappings
using fuzzy name matching, then applies them. This makes the system future-proof
for new source systems or ERP format changes.

This is OFF by default. The default mode (Phase 2) always uses the fixed 18-column
mapping. Template mode is a toggle in the UI.

### Requirements
- Template file is uploaded separately alongside the POS file
- Fuzzy matching using `difflib.SequenceMatcher` (no external ML deps)
- Returns a suggested mapping JSON the frontend renders for admin review
- Confirmed mapping can be used immediately for the current transformation

### User Stories
- As an admin, I want to upload a new ERP template and have the system suggest
  how to map POS columns to it, so I can support new ERP formats without writing code.

### Task
```
Create backend/routers/template_mode.py with:

--- POST /api/transform/with-template ---

Accept multipart/form-data:
  pos_file:      UploadFile   (the POS export)
  template_file: UploadFile   (a sample output file showing the desired columns)
  confirmed_mapping: str (optional) — JSON string of confirmed column mapping
                      If provided, skip suggestion and apply this mapping directly

Steps when confirmed_mapping is NOT provided (suggestion mode):
  1. Read both files with FileReader
  2. For each column in template file, score every column in POS file:
     a. Exact name match (case-insensitive) → score 1.0
     b. Fuzzy SequenceMatcher ratio → score 0.0–0.9
     c. Data type match bonus: +0.05 if both numeric, +0.05 if both string
  3. Return suggestion response:
     {
       "mode": "suggestion",
       "template_columns": list[str],
       "pos_columns": list[str],
       "suggestions": [
         {
           "output_col": str,
           "suggested_input_col": str | null,  (null if best score < 0.4)
           "confidence": float,                (0.0 – 1.0)
           "match_reason": str
         }
       ]
     }

Steps when confirmed_mapping IS provided:
  confirmed_mapping JSON format:
  [
    { "output_col": "Date", "source": "direct", "input_col": "Date", "transform": "date_reformat" },
    { "output_col": "Total Amount", "source": "direct", "input_col": "Gross Sales", "transform": "strip_commas_to_float" },
    { "output_col": "Customer", "source": "hardcoded", "value": "NA" }
  ]
  1. Read POS file with FileReader
  2. Apply the confirmed mapping dynamically (build output df column by column)
  3. Write output with FileWriter
  4. Return same response format as POST /api/upload

--- GET /api/transform/with-template/columns ---

Query param: filepath (path to an already-uploaded template file)
Returns list of columns from that file:
  { "columns": list[str] }
Used by frontend to show template columns before running full suggestion.
```

### Acceptance Criteria
- [ ] Suggestion returns one entry per template column
- [ ] Exact name matches score 1.0
- [ ] Columns with no match (score < 0.4) return `suggested_input_col: null`
- [ ] Confirmed mapping applies correctly and produces a downloadable file
- [ ] `difflib` used for fuzzy matching — no external ML dependencies

---

## Module 4.2: Template Mode UI Toggle

### Overview
Adds a toggle to the main upload page that switches between "Standard mode" (fixed
18-column mapping) and "Custom template mode" (upload your own output template).
In custom template mode, the UI shows an additional file upload zone for the template
and a mapping review table before transformation.

### Task
```
Modify frontend/app/page.tsx to add a mode toggle above the UploadForm:

  [● Standard Mode]  [○ Custom Template Mode]

Standard Mode (default): existing UploadForm from Module 3.2, unchanged.

Custom Template Mode:
  Add a second DropZone labeled "Upload ERP output template"
  When both files are selected and user clicks "Analyze Mapping":
    POST to /api/transform/with-template (suggestion mode)
    Show MappingReviewTable component

Create frontend/components/MappingReviewTable.tsx
  Props: suggestions: SuggestionItem[], posColumns: string[], onConfirm(mapping: MappingItem[])
  - One row per output/template column
  - Columns: Output Column | Suggested POS Column (dropdown) | Confidence badge | Transform (dropdown)
  - User can change any suggested POS column from the dropdown
  - Confidence badges: green ≥0.8, amber 0.5–0.79, red <0.5
  - Low confidence rows (< 0.5) highlighted with amber background
  - "Apply Mapping" button: collects confirmed mapping, POST to /api/transform/with-template
    with confirmed_mapping JSON, then shows same PreviewTable + DownloadPanel as standard mode

TypeScript additions to frontend/types/index.ts:
  interface SuggestionItem {
    output_col: string
    suggested_input_col: string | null
    confidence: number
    match_reason: string
  }
  interface MappingItem {
    output_col: string
    source: "direct" | "hardcoded"
    input_col?: string
    transform?: string
    value?: string
  }
```

### Acceptance Criteria
- [ ] Mode toggle switches between standard and custom template UI cleanly
- [ ] Both POS file and template file upload zones work independently
- [ ] Mapping table shows suggestions with color-coded confidence
- [ ] User can change any dropdown selection
- [ ] "Apply Mapping" produces a downloadable formatted file
- [ ] Standard mode is unchanged and still works

---

---

# PHASE 5: Admin Panel & Audit Log

---

## Module 5.1: Admin Dashboard

### Overview
A simple `/admin` page showing upload history, stats, and re-download options.
No auth in this module — that's added in Phase 6.

### Task
```
Create backend/routers/admin.py with:
  GET /api/admin/stats
    Returns:
    {
      "uploads_today": int,
      "uploads_this_month": int,
      "errors_today": int,
      "total_rows_processed": int
    }

  GET /api/admin/uploads?limit=50&offset=0
    Returns paginated upload history (same shape as GET /api/uploads but with more fields)

  POST /api/admin/uploads/{upload_id}/reprocess
    Re-runs the transformation pipeline on the originally uploaded file.
    Creates a new outputs file. Updates the uploads record with new output_file.
    Returns same shape as POST /api/upload.

Create frontend/app/admin/page.tsx:
  Section 1: Stats cards (Uploads Today, This Month, Errors Today, Rows Processed)
  Section 2: Upload history table
    Columns: Date/Time | Original Filename | Source System | Rows | Errors | Status | Actions
    Actions: Re-download output, Reprocess
  Navigation: Add link "Admin" in the root layout header
```

### Acceptance Criteria
- [ ] Admin page loads without errors
- [ ] Stats cards show correct counts from DB
- [ ] Upload history shows all past uploads
- [ ] Reprocess endpoint re-runs pipeline and updates output file
- [ ] Re-download works for previously processed files

---

## Module 5.2: Configurable Defaults Panel

### Overview
Once ERP access is obtained, admins will need to set the constant values for the
12 currently-defaulted columns (Customer, Product, Doc Class, etc.) without changing
code. This module adds a settings panel for that.

### Task
```
Add to database:

TABLE: column_defaults
  column_name    TEXT PRIMARY KEY
  default_value  TEXT NOT NULL
  value_type     TEXT NOT NULL    -- "string" | "int" | "float"
  description    TEXT
  updated_at     TEXT DEFAULT CURRENT_TIMESTAMP

Seed with current defaults on first run:
  Customer      → "NA"  (string)
  Product       → "NA"  (string)
  Doc Class     → "NA"  (string)
  Customer Code → "NA"  (string)
  Product Name  → "NA"  (string)
  Account Type  → "NA"  (string)
  Bank Code     → "NA"  (string)
  SI Number     → "NA"  (string)
  Order Number  → "NA"  (string)
  Class         → "0"   (int)
  Order Date    → "NA"  (string)
  Active        → "1"   (int)

Add to backend/routers/admin.py:
  GET  /api/admin/defaults          → list all defaults
  PUT  /api/admin/defaults/{column} → update a default value

Modify DataTransformer to load defaults from DB at transform time instead of hardcoding them.
  (Fall back to hardcoded values if DB is unavailable.)

Create frontend/app/admin/settings/page.tsx:
  A table of all 12 configurable columns:
    Column Name | Current Default | Value Type | Edit button
  Clicking Edit opens an inline edit field with Save/Cancel.
  On Save: PUT to /api/admin/defaults/{column}
  Show note: "These values are used when the POS file has no data for this column.
              Update them once you have access to the ERP."
```

### Acceptance Criteria
- [ ] Settings page shows all 12 configurable columns with current values
- [ ] Editing and saving a value persists to DB
- [ ] DataTransformer uses DB defaults, not hardcoded values
- [ ] Fallback to hardcoded values if DB query fails

---

---

# PHASE 6: Hardening & Deployment

---

## Module 6.1: Simple Authentication

### Overview
Add a minimal role-based login system protecting all routes.
Three roles: `cashier` (upload only), `accounting` (upload + download + preview),
`admin` (full access). Simple JWT-based auth using FastAPI + bcrypt.

### Task
```
Add to database:

TABLE: users
  id             INTEGER PRIMARY KEY AUTOINCREMENT
  username       TEXT UNIQUE NOT NULL
  password_hash  TEXT NOT NULL     -- bcrypt hash
  role           TEXT NOT NULL     -- cashier | accounting | admin
  is_active      INTEGER DEFAULT 1
  created_at     TEXT DEFAULT CURRENT_TIMESTAMP

Create backend/routers/auth.py:
  POST /api/auth/login
    Body: { "username": str, "password": str }
    Returns: { "access_token": str, "token_type": "bearer", "role": str }
    Returns 401 if credentials invalid or user inactive

  GET /api/auth/me
    Protected: requires valid JWT
    Returns: { "username": str, "role": str }

Route protection:
  /api/upload          → cashier, accounting, admin
  /api/download/*      → accounting, admin
  /api/admin/*         → admin only
  /api/auth/login      → public

Create seed script backend/seed_users.py:
  Creates default users:
    username: admin,       password: changeme, role: admin
    username: accounting,  password: changeme, role: accounting
    username: cashier,     password: changeme, role: cashier
  Print: "⚠ Default users created. Change passwords immediately."

Frontend:
  Create frontend/app/login/page.tsx
    Simple form: username + password, POST to /api/auth/login
    Store JWT in localStorage (or httpOnly cookie if adding middleware)
    Redirect to / on success, show error message on 401

  Add auth check to frontend/app/layout.tsx:
    If no token in storage → redirect to /login
    If token present → show nav with username + logout button
```

### Acceptance Criteria
- [ ] Unauthenticated requests to protected endpoints return HTTP 401
- [ ] Cashier cannot access `/api/admin/*`
- [ ] JWT expires after `ACCESS_TOKEN_EXPIRE_HOURS` from config
- [ ] Passwords are bcrypt-hashed in DB (never plaintext)
- [ ] Seed script runs without errors and produces working credentials
- [ ] Login page works and redirects correctly

---

## Module 6.2: Docker & Deployment

### Overview
Package the full application for deployment on a local office server or VPS using
Docker Compose. One command starts everything.

### Task
```
Create at project root:

backend/Dockerfile:
  FROM python:3.11-slim
  WORKDIR /app
  COPY requirements.txt .
  RUN pip install --no-cache-dir -r requirements.txt
  COPY . .
  CMD ["uvicorn", "main:app", "--host", "0.0.0.0", "--port", "8000"]

frontend/Dockerfile:
  FROM node:18-alpine
  WORKDIR /app
  COPY package*.json .
  RUN npm install
  COPY . .
  RUN npm run build
  CMD ["npm", "start"]

docker-compose.yml:
  services:
    backend:
      build: ./backend
      ports: ["8000:8000"]
      volumes:
        - ./uploads:/app/uploads
        - ./outputs:/app/outputs
        - ./db.sqlite3:/app/db.sqlite3
      env_file: .env
      restart: unless-stopped

    frontend:
      build: ./frontend
      ports: ["3000:3000"]
      environment:
        - NEXT_PUBLIC_API_URL=http://localhost:8000
      depends_on: [backend]
      restart: unless-stopped

    nginx:
      image: nginx:alpine
      ports: ["80:80"]
      volumes: ["./nginx.conf:/etc/nginx/conf.d/default.conf"]
      depends_on: [backend, frontend]
      restart: unless-stopped

nginx.conf:
  server {
    listen 80;
    client_max_body_size 20m;
    location /api { proxy_pass http://backend:8000; }
    location /    { proxy_pass http://frontend:3000; }
  }

Create DEPLOYMENT.md with steps:
  1. Install Docker Desktop (Windows/Mac) or Docker Engine (Linux)
  2. Clone the repo
  3. Copy .env.example to .env and set SECRET_KEY to a random string
  4. Run: docker-compose up -d
  5. Open http://localhost in browser
  6. Run: docker-compose exec backend python seed_users.py
  7. Login with admin / changeme and change password immediately
  8. Daily backup: cp db.sqlite3 backups/db_$(date +%Y%m%d).sqlite3
```

### Acceptance Criteria
- [ ] `docker-compose up` starts all services without errors
- [ ] Upload and download work end-to-end through Nginx on port 80
- [ ] DB file persists across container restarts (volume mount)
- [ ] `DEPLOYMENT.md` steps work on a clean machine

---

## Development Checklist

| Phase | Module | Description | Status |
|---|---|---|---|
| 1 | 1.1 | Project Setup & Configuration | ⬜ |
| 1 | 1.2 | Database Schema | ⬜ |
| 2 | 2.1 | File Reader | ⬜ |
| 2 | 2.2 | POS-to-ERP Transformer | ⬜ |
| 2 | 2.3 | Output File Writer | ⬜ |
| 3 | 3.1 | FastAPI Upload Endpoint | ⬜ |
| 3 | 3.2 | Next.js Upload Page | ⬜ |
| 4 | 4.1 | Custom Template Endpoint | ⬜ |
| 4 | 4.2 | Template Mode UI Toggle | ⬜ |
| 5 | 5.1 | Admin Dashboard | ⬜ |
| 5 | 5.2 | Configurable Defaults Panel | ⬜ |
| 6 | 6.1 | Authentication | ⬜ |
| 6 | 6.2 | Docker & Deployment | ⬜ |

---

*Last updated: June 2026*
*Project: ERP Excel Formatter Middleware*
