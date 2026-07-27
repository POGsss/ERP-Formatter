# REFACTOR_BACKEND.md

### ERP Formatter Backend Refactor — SQLite + Local Disk → Vercel (Postgres + Blob)

Source: Assessment of `backend/main.py`, `backend/config.py`, `backend/database.py`,
`backend/routers/upload.py`, `backend/routers/admin.py`, `backend/services/file_reader.py`,
`backend/services/file_writer.py`, `backend/requirements.txt`, `frontend/next.config.js`, and
`docker-compose.yml`.

Goal: run the **entire app on Vercel (Hobby / free tier) with full feature parity** — upload
history, audit log, admin dashboard, editable column defaults, reprocess, and delete all preserved.
Vercel functions are stateless with an ephemeral `/tmp` filesystem, so the two stateful dependencies
must move to managed services:

- **SQLite on disk → managed Postgres** (Vercel Postgres / Neon free tier).
- **`uploads/` + `outputs/` on disk → object storage** (Vercel Blob free tier).
- **`uvicorn` long-running server → a Vercel Python serverless function** exposing the FastAPI app.

This file is the phased implementation plan. Each phase is self-contained and independently
testable so it can be handed to a separate agent. The public HTTP contract (`/api/*` routes,
request/response shapes, `/api/download/{filename}`) is preserved so the frontend needs only a
one-line change. See **Cross-Cutting Notes** at the end for the platform limits, architecture
decisions, and the required managed-service accounts.

> Hard platform limit to design around: **Vercel serverless functions reject request bodies larger
> than ~4.5 MB.** The current `MAX_FILE_SIZE_MB=10` is therefore unreachable through a function.
> Set `MAX_FILE_SIZE_MB=4` for the Vercel deployment (see Phase 3).

---

## 1. Phase 1 — Database Layer: SQLite → Postgres

### Overview

Replace the on-disk SQLite backend in `backend/database.py` with managed Postgres via `psycopg`
(v3), while keeping every public function signature identical so `routers/upload.py` and
`routers/admin.py` require **no changes** in this phase. This phase is self-contained: it can be
built and tested by pointing `DATABASE_URL` at a free Neon/Vercel Postgres database, running
`init_db()`, and exercising the CRUD helpers directly.

### User Stories

- As the owner, I want upload history, the audit log, and my edited column defaults to persist
  across requests and redeploys, because Vercel functions have no persistent disk.
- As a developer, I want the database swap isolated to `database.py` so the routers and the
  transformation pipeline stay untouched.

### Requirements

- Rewrite `backend/database.py` to use `psycopg` (v3) against Postgres. Preserve the exact public
  API and behavior of every existing function so callers are unaffected:
  `get_db`, `init_db`, `insert_upload`, `update_upload`, `delete_upload`, `insert_audit`,
  `get_upload`, `get_recent_uploads`, `count_uploads`, `get_column_defaults`, `get_column_default`,
  `update_column_default`, plus the private helpers and the seed constants
  (`SEEDED_COLUMN_DEFAULTS`, `NEW_POS_SEEDED_COLUMN_DEFAULTS`, `TEMPLATE_COLUMN_DEFAULTS`, etc.).
- `get_db()` must return a connection object whose usage pattern in the routers still works:
  `with closing(get_db()) as conn:` and `conn.execute(sql, params).fetchone()/.fetchall()` and
  `conn.commit()`. Use `psycopg.connect(..., row_factory=psycopg.rows.dict_row)` so rows behave
  like dicts (`row["name"]` and `dict(row)` both work, matching the current `sqlite3.Row` usage).
- **One connection per call** (serverless-safe). `DATABASE_URL` must be a **pooled** Postgres
  connection string (Neon pooler / Vercel Postgres pooled URL). Do not hold a global long-lived
  connection.
- SQL dialect conversions (apply throughout the file):
  - Parameter placeholders `?` → `%s` (psycopg paramstyle).
  - `INTEGER PRIMARY KEY AUTOINCREMENT` → `GENERATED ALWAYS AS IDENTITY PRIMARY KEY`
    (or `SERIAL PRIMARY KEY`).
  - `insert_upload` returns the new id via `INSERT ... RETURNING id` + `fetchone()` instead of
    `cursor.lastrowid`.
  - `INSERT OR IGNORE ...` → `INSERT ... ON CONFLICT (<pk cols>) DO NOTHING`.
  - The `template_column_defaults` seed-from-`column_defaults` `INSERT OR IGNORE ... SELECT`
    becomes `INSERT ... SELECT ... ON CONFLICT (template, column_name) DO NOTHING`.
  - Remove `PRAGMA foreign_keys = ON`.
  - Remove the `PRAGMA table_info(uploads)` runtime migration block — the fresh schema already
    includes the `template` column (`CREATE TABLE IF NOT EXISTS uploads (... template TEXT DEFAULT
    'old_pos')`). No `ALTER TABLE` probing is needed.
- **Timestamp columns stay TEXT** to preserve the admin `LIKE 'YYYY-MM-DD%'` / `'YYYY-MM%'`
  filtering in `admin.py` without touching that file. Default them to an ISO string matching what
  SQLite's `CURRENT_TIMESTAMP` produced (`'YYYY-MM-DD HH24:MI:SS'`):
  - `uploaded_at TEXT DEFAULT to_char(now(), 'YYYY-MM-DD HH24:MI:SS')`
  - `created_at TEXT DEFAULT to_char(now(), 'YYYY-MM-DD HH24:MI:SS')`
  - `updated_at TEXT DEFAULT to_char(now(), 'YYYY-MM-DD HH24:MI:SS')`
  - Replace `SET updated_at = CURRENT_TIMESTAMP` in `update_column_default` with
    `SET updated_at = to_char(now(), 'YYYY-MM-DD HH24:MI:SS')`.
- Postgres schema (semantics identical to the current SQLite schema):
  - `uploads(id, filename NOT NULL, original_name NOT NULL, source_system, transaction_date,
    uploaded_at, status DEFAULT 'pending', row_count INTEGER DEFAULT 0,
    error_count INTEGER DEFAULT 0, output_file, error_report, uploader_ip,
    template TEXT DEFAULT 'old_pos')`.
  - `audit_log(id, upload_id INTEGER REFERENCES uploads(id), event NOT NULL, detail, warnings,
    errors, created_at)`.
  - `column_defaults(column_name TEXT PRIMARY KEY, default_value NOT NULL, value_type NOT NULL,
    description, updated_at)`.
  - `template_column_defaults(template, column_name, default_value NOT NULL, value_type NOT NULL,
    description, updated_at, PRIMARY KEY (template, column_name))`.
- `init_db()` remains idempotent: `CREATE TABLE IF NOT EXISTS` + `ON CONFLICT DO NOTHING` seeding,
  so it is safe to run repeatedly.
- `backend/config.py`: `DATABASE_URL` is now a **connection string**, not a filesystem path. Remove
  the `_resolve_project_path()` wrapping for `DATABASE_URL` (keep it required via `_get_required`).
  Leave `UPLOAD_DIR` / `OUTPUT_DIR` handling for Phase 2.
- `backend/requirements.txt`: add `psycopg[binary]` (v3). Keep existing dependencies.

### Tasks

1. Add `psycopg[binary]` to `backend/requirements.txt`.
2. In `config.py`, stop path-resolving `DATABASE_URL`; treat it as a raw connection string.
3. Rewrite `get_db()` to open a pooled `psycopg` connection with `dict_row` row factory.
4. Rewrite `init_db()` with Postgres DDL (IDENTITY keys, TEXT ISO timestamps, no PRAGMA, no
   table_info migration) and `ON CONFLICT DO NOTHING` seeding for all four tables.
5. Convert every query in the CRUD/seed helpers: `?`→`%s`, `RETURNING id`, `ON CONFLICT`,
   `to_char(now(), ...)` for `updated_at`.
6. Verify the dynamic-column builders in `insert_upload` / `update_upload` still emit valid
   `%s`-parameterized SQL.
7. Add a one-off `backend/scripts/init_db.py` (or a `__main__` block) that calls `init_db()` for
   provisioning/testing against a live Postgres URL.

### Expected Output

- `backend/database.py` — psycopg/Postgres implementation with unchanged public signatures.
- Updated `backend/config.py` — `DATABASE_URL` as a connection string.
- Updated `backend/requirements.txt` — includes `psycopg[binary]`.
- `backend/scripts/init_db.py` — idempotent schema provisioning entrypoint.

### Acceptance Criteria

- [ ] `init_db()` against an empty Postgres database creates all four tables and seeds
      `column_defaults` and `template_column_defaults` for both `old_pos` and `new_pos`.
- [ ] Running `init_db()` twice makes no duplicate rows and raises no errors (idempotent).
- [ ] `insert_upload` returns the new integer id; `get_upload`, `get_recent_uploads`,
      `count_uploads` return the same dict shapes as before.
- [ ] `get_column_defaults('old_pos')` and `get_column_defaults('new_pos')` return the seeded
      12 / 11 columns with descriptions and a `value` field, identical to today.
- [ ] `update_column_default` persists and bumps `updated_at`.
- [ ] `routers/upload.py` and `routers/admin.py` are **unchanged** and work against the new layer.
- [ ] Admin stat filters (`uploaded_at LIKE 'YYYY-MM-DD%'` / `'YYYY-MM%'`) still return correct
      counts because timestamps are stored as ISO text.

---

## 2. Phase 2 — File Storage: Local Disk → Vercel Blob

### Overview

Remove all dependence on a writable, persistent local filesystem. Uploaded source files and
generated ERP/error workbooks move to **Vercel Blob**. `FileReader` learns to read from an
in-memory buffer, `FileWriter` returns bytes instead of writing to disk, and the routers use a new
storage service for put/get/delete. The `/api/download/{filename}` contract is preserved via a
redirect to the Blob public URL. This phase is testable locally by setting the Blob token and
running an upload → download → reprocess → delete round trip.

### User Stories

- As POS staff, I want to upload a file and then download the generated result in a later request,
  which requires the output to live in durable storage rather than a per-invocation `/tmp`.
- As an admin, I want reprocess and delete to keep working, which requires the original source file
  and generated outputs to be fetchable/removable from storage.

### Requirements

- Add `backend/services/storage.py` — a small storage abstraction over Vercel Blob with:
  - `put_bytes(pathname: str, data: bytes, content_type: str) -> str` (returns the public URL).
  - `get_bytes(pathname: str) -> bytes`.
  - `delete(pathname: str) -> None`.
  - `public_url(pathname: str) -> str`.
  - Use the `vercel_blob` Python package (or direct HTTPS calls to the Blob API using
    `BLOB_READ_WRITE_TOKEN`). Use **deterministic pathnames** (`addRandomSuffix = false`) so
    objects can be addressed by name: `uploads/<stored_filename>` and `outputs/<output_filename>`.
- Deterministic public URLs: store the Blob public base in `BLOB_PUBLIC_BASE_URL`
  (e.g. `https://<store-id>.public.blob.vercel-storage.com`). `public_url(pathname)` =
  `f"{BLOB_PUBLIC_BASE_URL}/{pathname}"`.
- `backend/services/file_reader.py`: add support for reading from an in-memory buffer. Add
  `read_buffer(buffer, file_type, original_name)` (or make `read()` accept a file-like object).
  `pandas.read_excel` / `read_csv` already accept file-like objects, so `_read_raw` needs a variant
  that takes a `BytesIO` + explicit `file_type`. Keep the existing path-based `read()` working for
  the local `__main__` smoke test.
- `backend/services/file_writer.py`: `write(...)` must build the workbook(s) into `BytesIO` and
  return **bytes** rather than saving to `output_dir`. New return shape:
  `{ "output_filename": str, "output_bytes": bytes, "error_filename": str | None,
     "error_bytes": bytes | None }`. Keep the existing filename-generation logic
  (`_output_filename`, template prefixes) and the numeric/date formatting. Drop the
  `output_dir.mkdir` / `workbook.save(path)` disk writes. The router becomes responsible for
  uploading the returned bytes to storage.
- `backend/routers/upload.py`:
  - Read the uploaded bytes (already in memory as `content`), wrap in `BytesIO`, and pass to
    `FileReader.read_buffer(...)` instead of writing to `UPLOAD_DIR` and reading back.
  - `put_bytes(f"uploads/{stored_filename}", content, <content_type>)` so reprocess can fetch it.
  - After transform, call `FileWriter().write(...)`, then `put_bytes(f"outputs/{output_filename}",
    output_bytes, xlsx_content_type)` and, if present, the error report.
  - Keep storing just the **filenames** in `uploads.output_file` / `error_report` and keep the
    response `download_url = f"/api/download/{output_filename}"` unchanged.
  - `GET /api/download/{filename}`: keep `_safe_download_filename` validation, then return a
    `RedirectResponse` (HTTP 307) to `storage.public_url(f"outputs/{filename}")` instead of
    `FileResponse` from disk. (Alternative: stream bytes via `get_bytes` + `StreamingResponse` if
    you prefer not to expose public Blob URLs — see Cross-Cutting Notes.)
- `backend/routers/admin.py`:
  - `reprocess`: fetch the source via `storage.get_bytes(f"uploads/{filename}")` into a `BytesIO`
    and feed `FileReader.read_buffer(...)`; upload the regenerated outputs to Blob; keep the
    existing stale-output cleanup by deleting the old Blob objects first.
  - `delete`: replace `_delete_upload_artifacts` disk unlinks with `storage.delete("outputs/...")`,
    `storage.delete("outputs/<error_report>")`, and (when `include_source`)
    `storage.delete("uploads/<filename>")`. Keep the filename-safety checks.
- `backend/config.py`: replace `UPLOAD_DIR` / `OUTPUT_DIR` filesystem paths with storage-prefix
  constants (or keep the names as logical prefixes `"uploads"` / `"outputs"`). Remove the
  `Path(...).mkdir(...)` calls at import time. Add required env `BLOB_READ_WRITE_TOKEN` and
  `BLOB_PUBLIC_BASE_URL`.
- `backend/requirements.txt`: add the Blob client dependency (`vercel_blob`) if used.

### Tasks

1. Create `backend/services/storage.py` (put/get/delete/public_url over Vercel Blob, deterministic
   pathnames).
2. Add `read_buffer(...)` to `FileReader` (buffer + explicit file type).
3. Refactor `FileWriter.write(...)` to return bytes for the main workbook and the error report.
4. Rewrite the file-handling sections of `upload.py`: in-memory read, Blob put for source + output,
   redirect-based download.
5. Rewrite `reprocess` and `delete` in `admin.py` to use the storage service.
6. Update `config.py` env (`BLOB_READ_WRITE_TOKEN`, `BLOB_PUBLIC_BASE_URL`; drop disk paths/mkdir).
7. Add the Blob client to `requirements.txt`.
8. Add a local round-trip smoke test: upload sample → confirm Blob objects exist → download →
   reprocess → delete → confirm objects removed.

### Expected Output

- `backend/services/storage.py` — Vercel Blob storage abstraction.
- Updated `backend/services/file_reader.py` — buffer reading.
- Updated `backend/services/file_writer.py` — returns bytes.
- Updated `backend/routers/upload.py` — Blob-backed upload + redirect download.
- Updated `backend/routers/admin.py` — Blob-backed reprocess + delete.
- Updated `backend/config.py` and `backend/requirements.txt`.

### Acceptance Criteria

- [ ] Uploading `docs/Template/expectedInput.xlsx` stores `uploads/<uuid>.xlsx` and
      `outputs/<name>.xlsx` in Blob and writes nothing to the local disk.
- [ ] The upload response `download_url` (`/api/download/<name>.xlsx`) resolves to the generated
      file (via redirect to the Blob public URL) in a **separate** request.
- [ ] `reprocess` regenerates output from the Blob-stored source, deletes the previous output, and
      returns a working download URL.
- [ ] `delete` removes the upload row, audit rows, and the source/output/error Blob objects.
- [ ] `_safe_download_filename` still rejects `..`, `/`, `\`, and non-allowed extensions.
- [ ] No code path calls `Path(...).write_bytes`, `workbook.save(<path>)`, or reads/deletes a local
      upload/output file.
- [ ] The transformation output is byte-for-byte identical to the pre-refactor output for the same
      input and defaults.

---

## 3. Phase 3 — Vercel Serverless Entrypoint, Routing & Config

### Overview

Expose the FastAPI app as a Vercel Python serverless function, route `/api/*` and `/health` to it,
let Vercel build the Next.js frontend from `frontend/`, and wire all runtime configuration through
Vercel environment variables. Remove the frontend's dev-only `/api` proxy rewrite. After this
phase the whole app runs from a single Vercel deployment URL.

### User Stories

- As the owner, I want one Vercel project that serves both the UI and the API from one URL, for
  free, with no server to manage.
- As a developer, I want local dev to keep working and production routing to send `/api/*` to the
  Python function instead of a localhost backend.

### Requirements

- Add `api/index.py` at the repo root that exposes the FastAPI app for the `@vercel/python`
  runtime:
  - Add `backend/` to `sys.path`, then `from main import app`. Vercel's Python runtime serves the
    module-level ASGI `app`.
- Add a root `vercel.json` that builds both targets and routes correctly:
  - Build the Next app from `frontend/package.json` with `@vercel/next`.
  - Build `api/index.py` with `@vercel/python`.
  - Routes: `/health` → the Python function, `/api/(.*)` → the Python function, everything else →
    the Next app.
  - Set the Python function `maxDuration` (e.g. 30s) to cover Excel processing within Hobby limits.
- Provide the function's Python dependencies where the `@vercel/python` builder can find them:
  a root `requirements.txt` (or `api/requirements.txt`) that installs the backend dependencies
  (mirror `backend/requirements.txt`, including `psycopg[binary]` and the Blob client).
- `frontend/next.config.js`: **remove** the `rewrites()` that proxy `/api/:path*` to
  `API_BASE_URL` (that was for local docker/dev). In production, `vercel.json` routes `/api/*` to
  the Python function, and the browser calls same-origin relative `/api/...`, so no rewrite is
  needed. (For local dev without Vercel, developers can run the backend on `:8000` and use
  `vercel dev`, or keep a dev-only rewrite guarded by `NODE_ENV !== 'production'`.)
- `init_db()` on cold start: calling it inside the FastAPI `lifespan` on every cold start adds
  latency and repeated DDL. Preferred: run `backend/scripts/init_db.py` **once** during setup
  (against the provisioned Postgres) and gate the lifespan call behind an env flag
  (`RUN_INIT_DB_ON_START`, default off in production). Keep `init_db()` idempotent regardless.
- Set `MAX_FILE_SIZE_MB=4` for Vercel to respect the ~4.5 MB function request-body limit. Document
  the cap in the response/validation message if desired.
- Required Vercel environment variables (Production + Preview):
  `DATABASE_URL` (pooled Postgres), `BLOB_READ_WRITE_TOKEN`, `BLOB_PUBLIC_BASE_URL`, `SECRET_KEY`,
  `MAX_FILE_SIZE_MB=4`, `ALLOWED_EXTENSIONS=xlsx,xls,csv`, `ACCESS_TOKEN_EXPIRE_HOURS=24`,
  and `RUN_INIT_DB_ON_START=0`.

### Tasks

1. Create `api/index.py` exposing the FastAPI `app`.
2. Create root `vercel.json` with the two builds, the route table, and the Python `maxDuration`.
3. Create the root `requirements.txt` for the Python function (mirrors backend deps).
4. Remove the production `/api` rewrite from `frontend/next.config.js` (optionally keep a
   dev-guarded rewrite).
5. Gate `init_db()` in `backend/main.py` behind `RUN_INIT_DB_ON_START`; keep it idempotent.
6. Document all required Vercel environment variables and set `MAX_FILE_SIZE_MB=4`.
7. Provision the managed services (Vercel Postgres/Neon + Vercel Blob store), run the one-off
   `init_db` script, and deploy a preview.

### Expected Output

- `api/index.py` — Vercel Python entrypoint exposing FastAPI `app`.
- `vercel.json` — builds + routes for Next (frontend) and Python (api).
- Root `requirements.txt` — Python function dependencies.
- Updated `frontend/next.config.js` — no production `/api` proxy.
- Updated `backend/main.py` — env-gated `init_db()`.

### Acceptance Criteria

- [ ] A Vercel deployment builds the Next frontend and the Python function without errors.
- [ ] `GET /health` on the deployment URL returns `{"status": "ok", "service": "erp-formatter"}`.
- [ ] The frontend loads at the deployment root and calls `/api/*` same-origin successfully.
- [ ] Uploading a ≤4 MB sample on the deployed site processes, previews, and downloads the result.
- [ ] Recent uploads, admin stats, defaults, reprocess, and delete all work on the deployment.
- [ ] The Python function stays within the size and duration limits (no bundle-too-large or
      timeout errors on a normal sample file).
- [ ] Data and files persist across redeploys (Postgres + Blob), confirming statelessness is
      handled.

---

## 4. Phase 4 — Security Hardening (Recommended)

### Overview

The current backend uses `allow_origins=["*"]` and has **no authentication**, so a public Vercel
URL would let anyone upload files and hit the admin endpoints (reprocess/delete/defaults). This
phase locks the deployment down. It is recommended before going live but can be skipped if the URL
stays private.

### User Stories

- As the owner, I don't want strangers who discover the URL to upload files or delete history.
- As the owner, I want the browser app to keep working seamlessly while random API clients are
  rejected.

### Requirements

- Tighten CORS: replace `allow_origins=["*"]` in `backend/main.py` with an allow-list read from an
  `ALLOWED_ORIGINS` env var (the deployment origin[s]). Since the UI is same-origin on Vercel, CORS
  can be minimal.
- Add a shared-secret gate for mutating and admin routes: a FastAPI dependency that checks a header
  (e.g. `X-App-Token`) against `APP_ACCESS_TOKEN`. Apply it to `POST /api/upload` and all
  `/api/admin/*` routes at minimum. `GET /health` stays open.
- The frontend sends the token: read it from a server-side env and attach the header on API calls
  (or use a Vercel-protected preview / password protection as a lighter alternative).
- Do not commit secrets. `SECRET_KEY`, `APP_ACCESS_TOKEN`, `DATABASE_URL`, and
  `BLOB_READ_WRITE_TOKEN` live only in Vercel env vars. Confirm `backend/.env` (which contains
  personal AnyDesk credentials) is never bundled into the deployment.

### Tasks

1. Add `ALLOWED_ORIGINS` env and use it in the CORS middleware.
2. Add an `APP_ACCESS_TOKEN` dependency and apply it to `/api/upload` and `/api/admin/*`.
3. Wire the token into the frontend API calls (server-side env, not exposed to the client bundle).
4. Audit that no `.env` / secret file is included in the Vercel build; rotate the weak default
   `SECRET_KEY`.

### Expected Output

- Updated `backend/main.py` — env-driven CORS allow-list.
- New auth dependency (e.g. `backend/security.py`) guarding upload + admin routes.
- Updated frontend API calls attaching the access-token header.

### Acceptance Criteria

- [ ] Requests to `/api/upload` and `/api/admin/*` without a valid token return 401/403.
- [ ] The browser app continues to work end to end with the token configured.
- [ ] CORS rejects origins outside `ALLOWED_ORIGINS`.
- [ ] No secret values are present in the repository or the deployed bundle; the weak default
      `SECRET_KEY` is rotated.

---

## Cross-Cutting Notes

### Architecture Decisions

- **Preserve the HTTP contract, swap the backends.** Routes, request/response shapes, and
  `/api/download/{filename}` stay identical so the frontend change is a single removed rewrite.
  Only the persistence (Postgres) and storage (Blob) implementations change.
- **Signatures over rewrites.** Phase 1 keeps every `database.py` function signature so the routers
  are untouched by the DB swap. Phase 2 changes `FileWriter` to return bytes and moves I/O into the
  routers via a storage service, keeping transformers pure.
- **Deterministic Blob pathnames.** `uploads/<uuid>.<ext>` and `outputs/<name>.xlsx` with
  `addRandomSuffix=false` let the existing filename-based `/api/download/{filename}` contract map
  cleanly to storage objects.
- **Stateless function.** No global DB connection, no `/tmp` reliance for cross-request state; each
  invocation opens a pooled Postgres connection and reads/writes Blob.

### Data Migration

- This is a platform migration, not an in-place schema change. Existing local `db.sqlite3` history
  is **not** carried over by default (the app reseeds `column_defaults` / `template_column_defaults`
  from code). If historical `uploads` rows must be preserved, add an optional one-off export/import
  script (SQLite → Postgres) — out of scope for the core refactor.
- `column_defaults` and `template_column_defaults` are re-seeded idempotently by `init_db()`; any
  admin edits made after deployment persist in Postgres.

### Platform Limits (Vercel Hobby)

- **~4.5 MB** max request body per function → set `MAX_FILE_SIZE_MB=4`. Larger uploads need
  client-direct-to-Blob (future enhancement), not a function upload.
- **250 MB** unzipped function bundle → `pandas` + `numpy` + `openpyxl` + `xlrd` fit but are not
  tiny; watch for size warnings.
- **Function duration** capped on Hobby (raise `maxDuration` toward 60s if needed); small Excel
  files process well under this.
- **No persistent disk**; only ephemeral per-invocation `/tmp`. All durable state is Postgres +
  Blob.

### Required Managed Services (free tier)

- **Postgres**: Vercel Postgres or Neon. Use the **pooled** connection string for `DATABASE_URL`.
- **Vercel Blob**: create a store; use `BLOB_READ_WRITE_TOKEN` and the store's public base URL
  (`BLOB_PUBLIC_BASE_URL`).

### Breaking Changes

- `FileWriter.write(...)` return shape changes from disk paths to bytes
  (`output_bytes` / `error_bytes`). All callers (`upload.py`, `admin.py`) are updated in Phase 2.
- `GET /api/download/{filename}` returns a redirect (or streamed bytes) instead of a local
  `FileResponse`. The client-visible behavior (a file download at that URL) is unchanged.
- `config.py`: `DATABASE_URL` becomes a connection string; `UPLOAD_DIR` / `OUTPUT_DIR` become
  logical storage prefixes rather than filesystem paths.
- The Docker/Nginx stack (`docker-compose.yml`, `nginx/`, per-service `Dockerfile`s) is unrelated
  to the Vercel path and remains available for self-hosting; it is not modified by this refactor.

### Assumptions To Confirm

- **Public vs. private downloads.** The plan uses public Blob URLs via redirect (simplest). If
  generated files must not be publicly reachable, switch `/api/download` to stream bytes through
  the function with `get_bytes` + `StreamingResponse` and keep Blob objects private.
- **History retention.** Assumes existing local SQLite history does not need migrating. Confirm; if
  it does, add the export/import script noted above.
- **Auth model.** Phase 4 assumes a shared `APP_ACCESS_TOKEN` header is acceptable. If per-user
  auth is required, that is a larger, separate effort.

### Testing / Verification

- Phase 1: point `DATABASE_URL` at a free Neon/Vercel Postgres; run `init_db`; exercise all CRUD
  helpers and confirm the routers work unchanged.
- Phase 2: with the Blob token set, run upload → download → reprocess → delete locally and confirm
  Blob objects are created/removed and no local disk writes occur.
- Phase 3: deploy a Vercel preview; verify `/health`, an end-to-end upload/preview/download, admin
  stats/defaults/reprocess/delete, and persistence across a redeploy.
- Phase 4: verify token-gated routes reject unauthenticated calls, the UI still works, and CORS
  rejects foreign origins.
- Docs: update `docs/PHASE.md` / `docs/SYSTEM_OVERVIEW.md` to add the Vercel (Postgres + Blob)
  deployment target alongside the existing Docker deployment once all phases land.
