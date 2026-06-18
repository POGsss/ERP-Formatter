# DEVELOPMENT PHASES
## ERP Formatter - POS-to-ERP Middleware

These phases are written as implementation prompts that can rebuild the current system. Phases 1 through 6 describe the implemented product and deployment target.

## PHASE 1: Core Architecture

### Overview
Build the monorepo foundation for a FastAPI backend and a Next.js frontend. The system must load configuration from environment variables, create runtime folders, initialize SQLite, and expose a basic health check.

### Requirements
- Use Python 3.11 or newer with FastAPI, pandas, openpyxl, xlrd, python-dotenv, and python-multipart.
- Use Next.js 14 with the App Router, TypeScript, Tailwind CSS, and lucide-react.
- Keep backend code in `backend/` and frontend code in `frontend/`.
- Keep runtime files in `uploads/`, `outputs/`, and `db.sqlite3`, all ignored by Git.
- Use `.env` for backend paths, file limits, allowed extensions, and secret values.

### User Stories
- As a developer, I want a clear project structure so backend, frontend, runtime files, and docs are easy to find.
- As a developer, I want startup configuration to be repeatable across local and deployed environments.

### Task
- Create the backend FastAPI app with `config.py`, `database.py`, `main.py`, `routers/`, and `services/`.
- Load `UPLOAD_DIR`, `OUTPUT_DIR`, `DATABASE_URL`, `MAX_FILE_SIZE_MB`, `ALLOWED_EXTENSIONS`, `SECRET_KEY`, and `ACCESS_TOKEN_EXPIRE_HOURS` from the backend environment.
- Create upload and output directories automatically when config loads.
- Initialize SQLite on backend startup and expose `GET /health`.
- Create the frontend app with shared UI components, Tailwind setup, Next rewrites for `/api/*`, and a minimal app shell.

### Expected Output
- The backend starts locally and returns a healthy JSON response from `/health`.
- The frontend starts locally and can proxy `/api/*` requests to the backend.
- Runtime folders are created automatically and are not committed.

### Acceptance Criteria
- [ ] Backend starts without import or config errors.
- [ ] `/health` returns HTTP 200.
- [ ] Frontend starts without TypeScript errors.
- [ ] `.env`, uploads, outputs, SQLite files, node modules, and build artifacts are ignored by Git.

## PHASE 2: Transformation Engine

### Overview
Build the Python processing core that reads POS exports, detects the real header row, transforms the data into the FACT ERP.NG Sale Invoice format, and writes formatted Excel output files.

### Requirements
- Accept `.xlsx`, `.xls`, and `.csv` files.
- Detect and skip Mosaic POS metadata rows instead of hardcoding one header row.
- Return clean pandas DataFrames with stripped column names.
- Produce exactly 12 ERP output columns in the required order.
- Write `.xlsx` outputs with a main ERP import sheet and an error report only when errors exist.

### User Stories
- As accounting, I want a POS file converted to the exact ERP import shape without manually remapping columns.
- As a developer, I want one file reader and one transformer that can be reused by upload, reprocess, and template flows.

### Task
- Implement a file reader service that reads raw Excel or CSV files, detects the header row, extracts metadata, and preserves source values for transformer cleanup.
- Implement a transformer service that outputs SI Number, Invoice Date, Product Code, Quantity, Unit Price, Amount, Term Amount, Term Code, Customer Code, Doc Class, Currency Code, and Remarks.
- Generate SI Number from the POS Date as `DDMMYYYY`.
- Compute Unit Price as `(Net Sales - VAT - VAT Adjustment) / Quantity`.
- Compute Amount as `Net Sales - VAT - VAT Adjustment`.
- Compute Term Amount as `VAT + VAT Adjustment`.
- Load column defaults from SQLite at transform time and let non-formula defaults override native logic.
- Implement a writer service that creates timestamped Excel files in the output directory and includes column summary or error information where appropriate.

### Expected Output
- A valid Mosaic POS export becomes a 12-column ERP-ready workbook.
- Missing numeric source values safely become zero where applicable.
- Invalid or missing dates use today and create warnings.
- Column summary data explains whether each output column was mapped, computed, hardcoded, defaulted, or overridden.

### Acceptance Criteria
- [ ] Output columns always appear in the required 12-column order.
- [ ] Unit Price and Amount use the same net-of-VAT computation.
- [ ] Term Amount equals VAT plus VAT Adjustment.
- [ ] Admin default overrides are reflected in the output and summary.
- [ ] Generated workbooks open in Excel.

## PHASE 3: Web Application

### Overview
Build the main upload workflow that connects the frontend to the FastAPI pipeline. The user should upload a POS file, process it, preview output rows, download the generated file, and see basic processing stats.

### Requirements
- Provide `POST /api/upload` for standard POS processing.
- Provide `GET /api/download/{filename}` with safe filename checks.
- Validate allowed file types and file size before processing.
- Store upload history, status, row count, error count, output filename, error report filename, and uploader IP.
- Show a compact operational UI instead of a landing page.

### User Stories
- As POS staff, I want to drag and drop a valid POS export and process it quickly.
- As accounting, I want to preview the generated ERP rows before downloading the file.

### Task
- Build the FastAPI upload endpoint that saves the source file, reads it, transforms it, writes output, updates database history, and returns preview rows with download links.
- Build the frontend home page with stat cards, Standard and Template mode toggle, drop zones, process summary, output preview, and download button.
- Use restrained black, white, zinc, and gray styling with white bordered panels and compact tables.
- Show clear loading, success, and error states without browser alerts.

### Expected Output
- Uploading a valid POS file creates one source file, one output file, one database upload record, and a visible preview.
- The generated output can be downloaded from the browser.
- Invalid uploads return readable errors.

### Acceptance Criteria
- [ ] Standard upload works end to end.
- [ ] Preview table shows returned rows and column summary styling.
- [ ] Download links work only for safe output filenames.
- [ ] UI remains compact and work-focused on desktop and mobile.

## PHASE 4: Template Mode

### Overview
Add an optional custom template mode for cases where the ERP output columns differ from the fixed Sale Invoice format. The system should suggest mappings, let the user review them, and process confirmed mappings.

### Requirements
- Support a POS file and an ERP output template file in the same workflow.
- Suggest mappings by comparing template columns against POS columns.
- Use deterministic fuzzy matching with no machine learning dependency.
- Allow users to adjust mappings before processing.
- Return the same output response shape as standard upload after confirmed processing.

### User Stories
- As an admin, I want to upload a different ERP template and receive suggested mappings so the system can adapt without code changes.
- As accounting, I want to review low-confidence mappings before generating output.

### Task
- Implement `POST /api/transform/with-template` for suggestion mode and confirmed mapping mode.
- Read POS and template files with the shared file reader.
- Score suggested mappings using exact matches, fuzzy name similarity, and basic data type hints.
- Build a mapping review table in the frontend with dropdowns for POS columns and transform options.
- Process confirmed mappings into an output workbook and show the same preview/download experience as Standard mode.

### Expected Output
- Template mode first returns suggested mappings.
- Confirmed mappings generate a downloadable workbook.
- Standard mode remains unchanged.

### Acceptance Criteria
- [ ] Template and POS drop zones work independently.
- [ ] Suggestions show one row per template output column.
- [ ] Low-confidence suggestions are visible for review.
- [ ] Confirmed mappings generate output and preview rows.

## PHASE 5: Admin Settings, Recent Uploads, and Cleanup

### Overview
Add the implemented admin-facing controls that make the tool maintainable: stats, recent uploads, reprocess, delete, and configurable defaults.

### Requirements
- Provide admin stats for uploads today, uploads this month, errors today, and total rows processed.
- Provide recent upload history with enough metadata for review and reprocessing.
- Support reprocessing an existing uploaded source file.
- Delete upload records and their related files to prevent database and disk bloat.
- Provide configurable defaults for all 12 ERP output columns.

### User Stories
- As an admin, I want to update Product Code, Customer Code, Doc Class, Currency Code, and other defaults without changing code.
- As accounting, I want to reprocess an old file after defaults change.
- As an admin, I want to delete old processed items so the database and runtime folders stay clean.

### Task
- Implement `GET /api/admin/stats`, `GET /api/admin/uploads`, `POST /api/admin/uploads/{upload_id}/reprocess`, `DELETE /api/admin/uploads/{upload_id}`, `GET /api/admin/defaults`, and `PUT /api/admin/defaults/{column}`.
- Seed the `column_defaults` table with the 12 ERP output columns and update seed descriptions without overwriting user values.
- On reprocess, delete the previous output and error report before writing the updated result.
- On delete, remove audit rows, the upload row, source file, output file, and error report.
- Build Recent Upload with icon-only eye and trash actions.
- Build Default Settings with a table that grows with its content, icon-only pencil and X actions, and a text Save button.

### Expected Output
- Recent Upload can select, reprocess, and delete processed items.
- Reprocessing keeps only the latest generated output for that upload.
- Default Settings edits persist and affect later transformations.
- The UI uses lucide icons for compact repeated actions.

### Acceptance Criteria
- [ ] Admin stats and recent upload data load on the home page.
- [ ] Reprocess updates the existing upload record and removes stale output files.
- [ ] Delete removes the upload, audit records, and related files.
- [ ] Default values save to SQLite and are used by the transformer.
- [ ] Default Settings has no inner vertical table scroll.
- [ ] No authentication is required in the current implementation.

## PHASE 6: Docker Deployment

### Overview
Package the current implementation for Docker deployment so the app can run on a VPS, office server, or local machine exposed through a secure tunnel. This phase should not add authentication. It should make the existing FastAPI, Next.js, SQLite, upload, and output workflow available from outside the developer machine.

### Requirements
- Use Docker Compose to run backend, frontend, and Nginx together.
- Persist SQLite, uploads, and outputs across container restarts with host-mounted volumes or named volumes.
- Keep backend environment values outside images.
- Route browser traffic through Nginx so users can open one public URL.
- Support external access through a VPS public IP, a domain, Cloudflare Tunnel, ngrok, or equivalent tunneling service.
- Document local and internet-facing deployment steps clearly.

### User Stories
- As the owner, I want to run one Docker command and make the ERP Formatter available to coworkers or friends.
- As accounting, I want the same upload, preview, download, reprocess, and delete workflow to work from a shared URL.
- As an operator, I want processed files and upload history to survive restarts and rebuilds.

### Task
- Add a backend Dockerfile that installs Python dependencies from `backend/requirements.txt`, copies backend code, and starts FastAPI with Uvicorn.
- Add a frontend Dockerfile that installs Node dependencies, builds the Next.js app, and starts the production server.
- Add a Docker Compose file at the project root with backend, frontend, and Nginx services.
- Configure backend volumes so `UPLOAD_DIR`, `OUTPUT_DIR`, and `DATABASE_URL` point to persistent mounted paths.
- Configure frontend environment so Next rewrites send `/api/*` traffic to the backend service inside Docker.
- Add Nginx configuration that proxies `/api/` and `/health` to backend and all other routes to frontend.
- Add a concise Docker deployment document with setup, rebuild, logs, backup, restore, update, and external-access instructions.
- Include a warning to rotate secrets and avoid committing `.env` or runtime files.

### Expected Output
- A local user can run the Compose stack and open the app through Nginx.
- A VPS or tunnel setup can expose the same Nginx endpoint to friends outside the local network.
- Upload history, generated files, and default settings persist after container restarts.
- The deployment document explains the recommended option for public access and the quick tunnel option for temporary sharing.

### Acceptance Criteria
- [ ] Docker Compose builds and starts backend, frontend, and Nginx.
- [ ] `/health` works through the public Nginx endpoint.
- [ ] Upload, preview, download, reprocess, delete, and Default Settings work through Docker.
- [ ] SQLite, uploads, and outputs persist after `docker compose down` and restart.
- [ ] The deployment guide explains VPS, domain, firewall, and tunnel choices.
- [ ] Phase 6 does not add authentication or change application behavior.

*Last updated: June 2026*
