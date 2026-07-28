# DESKTOP_APP.md

### ERP Formatter Desktop Packaging — One-Click Local Executable

Source: Assessment of `backend/main.py`, `backend/config.py`, `backend/routers/upload.py`,
`backend/routers/admin.py`, `backend/services/*`, `backend/requirements.txt`,
`frontend/next.config.js`, `frontend/app/layout.tsx`, `frontend/app/page.tsx`,
`frontend/app/settings/page.tsx`, `frontend/app/admin/*`, and `docker-compose.yml`.

Goal: ship the whole app as a **single Windows executable** the user double-clicks to open a
working ERP Formatter — **no Python, no Node, no manual server steps, nothing to install**. The app
runs entirely on the local machine.

Why this fits: the app is stateful (SQLite + local upload/output files) and single-user, so running
locally means **the database and file storage work exactly as they do today** — none of the
Postgres/Blob refactor in `docs/REFACTOR_BACKEND.md` is required. This is a separate track from the
Vercel plan.

**Verified design decisions (see Cross-Cutting Notes for the evidence):**

- **PyInstaller `--onefile`** bundles the CPython interpreter and every dependency (pandas, numpy,
  openpyxl, xlrd, FastAPI, uvicorn) into one `.exe`. The target machine needs no Python or pip.
- **FastAPI serves both the UI and the API from one origin**, so there is no CORS and no `/api`
  proxy at runtime.
- **The launcher opens the user's default browser** at `http://127.0.0.1:<port>` instead of a
  native WebView2 window. Every Windows machine has a browser, so there is **no WebView2 runtime
  dependency** to be missing.
- **The server binds to `127.0.0.1` only** (loopback), so it is never network-reachable and Windows
  does not raise a firewall prompt.

**Known residual (not a dependency, documented honestly):** an unsigned `.exe` triggers a one-time
Windows SmartScreen "Run anyway" click and can be false-flagged by antivirus. Only a code-signing
certificate removes this (optional, Phase 3).

This file is the phased implementation plan. Each phase is self-contained and independently
testable so it can be handed to a separate agent. All changes are **gated** so the existing Docker /
`next start` web deployment keeps working.

---

## 1. Phase 1 — Static Frontend Export + Single-Origin FastAPI

### Overview

Make the Next.js frontend exportable to static HTML/JS and have FastAPI serve those static files
alongside the `/api` routes on one origin. This removes the need for a Node process and the `/api`
rewrite at runtime. The frontend already qualifies: every page is a client component (`"use
client"`) and there are no server-only features (no `next/headers`, `cookies()`, server actions,
route handlers, or `next/image`). This phase is testable without any packaging: build the static
site, run FastAPI, and confirm the whole app works from `http://127.0.0.1:8000`.

### User Stories

- As the owner, I want the UI and API served from a single local server so there is nothing to
  proxy and no second process to run.
- As a developer, I want static export gated so the existing Docker/`next start` deployment is not
  broken.

### Requirements

- `frontend/next.config.js`: enable static export **conditionally** so both targets coexist:
  - When `NEXT_OUTPUT === "export"` (desktop build): set `output: "export"`, set
    `images: { unoptimized: true }`, and **omit** the `rewrites()` (static export does not support
    rewrites).
  - Otherwise (default / Docker / dev): keep today's behavior, including the `/api` → `API_BASE_URL`
    rewrite.
- Static export writes to `frontend/out/` (`index.html`, `settings/index.html`,
  `admin/index.html`, `admin/settings/index.html`, plus `_next/` assets). Verify all four routes
  export as static pages.
- The browser must call the API with **same-origin relative** paths (`/api/...`). Confirm the
  frontend already uses relative `/api` URLs (it does — e.g. `download_url` is `/api/download/...`).
  No absolute backend URLs may remain in the exported bundle.
- `backend/main.py`: serve the exported frontend **conditionally**, without breaking web mode:
  - Read an env var `FRONTEND_DIST_DIR`. If it is set and the directory exists, mount it at `/`
    with `StaticFiles(directory=FRONTEND_DIST_DIR, html=True)` **after** the API routers are
    included, so `/health` and `/api/*` still resolve first and everything else falls through to
    the static site (SPA/index handling via `html=True`).
  - If `FRONTEND_DIST_DIR` is unset (Docker/web mode), do not mount static files — behavior is
    unchanged.
- Same-origin means CORS is unnecessary in desktop mode; leaving the current permissive CORS in
  place is acceptable here because the server is loopback-only (tightening is covered by the web
  track, not this one).

### Tasks

1. Add the `NEXT_OUTPUT === "export"` branch to `frontend/next.config.js` (output export, images
   unoptimized, no rewrites); keep the existing branch as default.
2. Build the static site (`NEXT_OUTPUT=export npm run build`) and confirm `frontend/out/` contains
   all four routes.
3. Add the conditional `StaticFiles` mount to `backend/main.py` driven by `FRONTEND_DIST_DIR`,
   mounted after the routers.
4. Manually run: set `FRONTEND_DIST_DIR=../frontend/out`, start `uvicorn main:app`, open
   `http://127.0.0.1:8000`, and exercise upload → preview → download, recent uploads, settings, and
   admin.

### Expected Output

- Updated `frontend/next.config.js` — gated static export.
- Updated `backend/main.py` — gated single-origin static serving.
- A generated `frontend/out/` static bundle (build artifact, not committed).

### Acceptance Criteria

- [ ] `NEXT_OUTPUT=export npm run build` produces `frontend/out/` with `index.html`,
      `settings/`, `admin/`, and `admin/settings/` pages.
- [ ] With `FRONTEND_DIST_DIR` pointed at `out/`, FastAPI serves the app at `/` and the API at
      `/api/*` from the same origin.
- [ ] Upload, preview, download, recent uploads, reprocess, delete, and Default Settings all work
      end to end through the single server.
- [ ] With `FRONTEND_DIST_DIR` unset, `next start` + the Docker stack behave exactly as before
      (rewrite intact, no static mount).
- [ ] No absolute `http://localhost:8000` (or similar) API URL remains in the exported bundle.

---

## 2. Phase 2 — App-Data Storage + One-Click Launcher

### Overview

Add a launcher that boots the server on a free loopback port and opens the browser, and route all
writable data (SQLite, uploads, outputs) to a per-user app-data folder so a read-only `--onefile`
temp extraction never tries to write into itself. The launcher sets every required environment
variable before importing the app, so `config.py` needs no change to its strict validation. This
phase is testable from source (`python backend/desktop.py`) before any packaging.

### User Stories

- As the user, I want to double-click one thing and have the app open in my browser with no setup.
- As the owner, I want the database and processed files stored in a stable local folder that
  survives app updates and is not wiped when the exe closes.

### Requirements

- Add `backend/desktop.py` (the packaged entrypoint). On start it must, **in this order**:
  1. Resolve the app-data directory: `%LOCALAPPDATA%\ERPFormatter\` on Windows (fall back to a
     home-directory path on other OSes). Create `uploads/`, `outputs/`, and the DB path under it.
  2. Ensure a stable `SECRET_KEY`: read it from `<appdata>/secret.key`; if absent, generate a
     random key (e.g. `secrets.token_urlsafe(48)`) and persist it there.
  3. Set environment variables **before importing the app**, so `config.py`'s `_get_required`
     checks all pass: `UPLOAD_DIR`, `OUTPUT_DIR`, `DATABASE_URL` (absolute app-data paths),
     `MAX_FILE_SIZE_MB` (10), `ALLOWED_EXTENSIONS` (`xlsx,xls,csv`), `SECRET_KEY`,
     `ACCESS_TOKEN_EXPIRE_HOURS` (24).
  4. Resolve and set `FRONTEND_DIST_DIR` to the static bundle location: `sys._MEIPASS`-relative when
     frozen (PyInstaller), else `../frontend/out` in dev.
  5. Pick a free port by binding a socket to `127.0.0.1:0` and reading the assigned port.
  6. Start uvicorn programmatically (`uvicorn.Server(uvicorn.Config(app, host="127.0.0.1",
     port=port, log_level="warning"))`) on a background thread.
  7. Poll `http://127.0.0.1:<port>/health` until it returns 200 (with a timeout), then
     `webbrowser.open(f"http://127.0.0.1:{port}/")`.
  8. Keep the process alive while the server runs, and print a clear message
     (`ERP Formatter is running. Keep this window open. Close it to quit.`) so the user knows how to
     stop it.
- `config.py` requires **no change** because the launcher supplies all env vars. (Absolute paths
  already pass through `_resolve_project_path` unchanged; the import-time `mkdir` calls succeed
  against the app-data paths.)
- Because `DATABASE_URL` is an absolute app-data path, SQLite and all current file I/O work
  unchanged — no database or storage refactor.
- Do not bind to `0.0.0.0`. Loopback only.

### Tasks

1. Create `backend/desktop.py` implementing the startup sequence above.
2. Implement app-data resolution + directory creation + persistent `SECRET_KEY` generation.
3. Implement free-port selection, threaded uvicorn startup, `/health` readiness polling, and
   `webbrowser.open`.
4. Add a keep-alive loop / message and clean shutdown on `KeyboardInterrupt`.
5. Run `python backend/desktop.py` from source (with `frontend/out/` built) and confirm the browser
   opens to a fully working app and data lands in the app-data folder.

### Expected Output

- `backend/desktop.py` — the one-click launcher / packaged entrypoint.
- Data written under `%LOCALAPPDATA%\ERPFormatter\` (DB, uploads, outputs, secret.key).

### Acceptance Criteria

- [ ] Running the launcher starts the server on a free `127.0.0.1` port and opens the browser
      automatically to the working app.
- [ ] SQLite DB, uploads, and outputs are created under `%LOCALAPPDATA%\ERPFormatter\`, not in the
      program folder or temp.
- [ ] `SECRET_KEY` is generated once and reused on subsequent launches (stable across restarts).
- [ ] Closing the launcher window / Ctrl+C stops the server cleanly.
- [ ] No firewall prompt appears (loopback-only bind).
- [ ] Data persists across relaunches.

### Optional Enhancements (note, do not require)

- A system-tray icon (`pystray`) with a "Quit" item instead of a console window, for a cleaner feel
  (adds a dependency).
- A splash/loading page while the server warms up.

---

## 3. Phase 3 — PyInstaller One-File Packaging + Verification

### Overview

Package `backend/desktop.py`, the backend code, and the static `frontend/out/` bundle into a single
`ERPFormatter.exe` with PyInstaller `--onefile`. Verify on a clean Windows machine that a
double-click opens the working app with nothing pre-installed. Document the SmartScreen behavior and
the optional code-signing step.

### User Stories

- As the owner, I want to hand a colleague one `.exe` file; they double-click it and the app opens.
- As the owner, I want to know exactly what (if anything) the user must click through on first run.

### Requirements

- Build order: (1) `NEXT_OUTPUT=export npm run build` in `frontend/` to produce `out/`; (2) run
  PyInstaller against `backend/desktop.py`.
- Bundle the static site with `--add-data "frontend/out;frontend/out"` (Windows uses `;` as the
  `--add-data` separator). `desktop.py` locates it via `sys._MEIPASS` when frozen.
- Provide a committed `ERPFormatter.spec` (PyInstaller spec) capturing: the entry script, the
  `datas` for `frontend/out`, and any required hidden imports / collected packages. Anticipate
  common needs:
  - `--collect-submodules uvicorn` (or hidden imports for `uvicorn.logging`, `uvicorn.loops.auto`,
    `uvicorn.protocols.*`, `uvicorn.lifespan.*`).
  - Verify `pandas`, `numpy`, `openpyxl`, and `xlrd` bundle correctly; add
    `--collect-data openpyxl` / hidden imports only if a runtime import error appears.
- Console vs windowed: default to a **console build** so the "running" window is visible and the
  user can close it to quit. (A `--windowed` build requires the tray-icon enhancement from Phase 2
  to remain quittable.)
- Output: a single `dist/ERPFormatter.exe`.
- Add a short `scripts/build_desktop.ps1` (or documented commands) that runs the two build steps in
  order.
- Document the first-run experience honestly: unsigned exe → Windows SmartScreen
  "Windows protected your PC" → *More info* → *Run anyway*. Note antivirus false-positive
  possibility. Note that a code-signing certificate is the only way to remove the warning
  (optional, has an annual cost).
- Note scope: PyInstaller produces a **Windows x64** exe when built on Windows x64. macOS/Linux or
  ARM require separate builds on those platforms.

### Tasks

1. Add `pyinstaller` to a dev/build requirements list (build-time only; not a runtime dependency).
2. Create `ERPFormatter.spec` with the entry script, `frontend/out` data, and hidden imports.
3. Add `scripts/build_desktop.ps1` running the frontend export then the PyInstaller build.
4. Build `dist/ERPFormatter.exe` and smoke-test it on the build machine.
5. Verify on a **clean** Windows machine (or fresh VM with no Python/Node) that a double-click opens
   the working app and data persists in app-data.
6. Document the SmartScreen/AV first-run steps and the optional code-signing path.

### Expected Output

- `ERPFormatter.spec` — PyInstaller build definition.
- `scripts/build_desktop.ps1` — one-command build (frontend export + package).
- `dist/ERPFormatter.exe` — the single distributable (build artifact, not committed).

### Acceptance Criteria

- [ ] `ERPFormatter.exe` launches on a machine with **no Python, no Node, and no pip packages**
      installed.
- [ ] Double-clicking opens the browser to a fully working app (upload, preview, download, recent
      uploads, reprocess, delete, settings, admin).
- [ ] SQLite, uploads, and outputs are stored in `%LOCALAPPDATA%\ERPFormatter\` and persist across
      relaunches.
- [ ] No Python/dependency error dialogs; no firewall prompt.
- [ ] The only first-run friction is the documented SmartScreen "Run anyway" click (unless the exe
      is code-signed).
- [ ] The build script reproducibly regenerates the exe from a clean checkout.

---

## Cross-Cutting Notes

### Architecture Decisions

- **Single origin, single process.** FastAPI serves the exported static frontend and the `/api`
  routes together, so there is no Node runtime, no CORS, and no `/api` proxy at run time.
- **Browser launch over native window.** Opening the default browser avoids the WebView2 runtime
  dependency entirely; every Windows machine has a browser. A native window (pywebview/WebView2) is
  deliberately **not** used to keep "download and run" dependency-free.
- **Loopback-only.** Binding to `127.0.0.1` keeps the server off the network (no exposure, no
  firewall prompt) and makes the permissive CORS and missing-auth concerns from the web track moot.
- **Writable data in app-data.** SQLite/uploads/outputs live in `%LOCALAPPDATA%\ERPFormatter\`, not
  inside the read-only onefile temp extraction, so state persists and writes never fail.
- **Env injected by the launcher.** `desktop.py` sets all required env vars before importing the
  app, so `config.py` keeps its strict validation and needs no change.
- **Gated so both targets coexist.** Static export and static serving are behind `NEXT_OUTPUT` /
  `FRONTEND_DIST_DIR`, so the existing Docker/`next start` deployment is unaffected.

### Verified Facts (evidence)

- **PyInstaller onefile** — official PyInstaller docs: it "bundles a Python application and all its
  dependencies into a single package. The user can run the packaged app without installing a Python
  interpreter or any modules," and explicitly bundles packages like numpy. → No Python/pip on the
  target.
- **WebView2 dependency (why it is avoided)** — Microsoft's distribution docs state developers must
  "make sure that the WebView2 Runtime is present on the client machine." It is evergreen and
  present on most modern Windows but not guaranteed everywhere. Using the default browser removes
  this risk.

### Known Residuals / Honest Caveats

- **SmartScreen / antivirus** on an unsigned exe: one-time "Run anyway" click; possible AV
  false-positive. Removed only by code signing (optional, annual cost).
- **First-launch unpack delay**: onefile extracts to temp on each start; expect a few seconds and a
  large (~80–200 MB) file because pandas/numpy are bundled.
- **Per-OS builds**: the exe is Windows-only; other platforms need their own builds.
- **Local-machine reachability**: a loopback server is reachable by other processes on the same
  machine. For an internal tool this is normally fine; a per-launch random token is an optional
  hardening step.

### Relationship to Other Docs

- This desktop track is an **alternative** to the Vercel plan in `docs/REFACTOR_BACKEND.md`. Desktop
  keeps SQLite + local files as-is; Vercel requires Postgres + Blob. The codebase can support both
  via the `NEXT_OUTPUT` / `FRONTEND_DIST_DIR` gating plus environment config, but pick one primary
  distribution model.
- No changes here affect the Docker deployment (`docker-compose.yml`, `nginx/`, per-service
  `Dockerfile`s).

### Testing / Verification

- Phase 1: build `out/`, run FastAPI with `FRONTEND_DIST_DIR`, verify full app on one origin and
  that Docker/web mode is unchanged when the flags are absent.
- Phase 2: run `python backend/desktop.py` from source; confirm auto browser launch, app-data
  storage, stable secret, loopback bind, and clean shutdown.
- Phase 3: build the exe; verify on a clean Windows machine with no Python/Node that a double-click
  yields a fully working, persistent app; document the SmartScreen steps.
- Docs: update `docs/PHASE.md` / `docs/SYSTEM_OVERVIEW.md` to add the desktop distribution target
  once all phases land.
