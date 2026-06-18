# SYSTEM OVERVIEW
## ERP Formatter - POS-to-ERP Middleware

## Purpose
ERP Formatter is an internal web app that converts raw Mosaic POS exports into FACT ERP.NG Sale Invoice import files. It reads `.xlsx`, `.xls`, and `.csv` files, applies a fixed ERP mapping or an optional custom template mapping, previews the result, and writes a downloadable `.xlsx` output for accounting.

## Current Scope
The current implementation covers the full upload, transform, preview, download, recent-upload, reprocess, delete, template-mode, and default-settings workflow. Authentication is not implemented. Deployment is not implemented yet and is planned as a Docker-based phase.

## Users
Cashier or POS staff upload the daily POS file. Accounting reviews the preview and downloads the ERP-ready output. Admin users maintain default values, reprocess previous uploads, and delete old processed records to control database and file storage size.

## Application Design
The interface uses a quiet operational dashboard style. The app has a black header, light gray page background, white bordered panels, compact stat cards, dense tables, and restrained monochrome controls. Actions use lucide icons where possible, including eye and trash icons in Recent Upload and pencil and X icons in Default Settings. The layout avoids marketing-style hero sections and focuses on repeated accounting work, quick scanning, and clear process feedback.

## Frontend
The frontend is a Next.js 14 App Router app in `frontend/`. The home page shows workspace stats, a Standard or Template upload mode toggle, drag-and-drop file inputs, a process summary panel, a recent upload panel, mapping review when template mode is used, and an output preview table. The Default Settings page shows all configurable ERP output columns in a table that grows with its content instead of using an inner vertical scroll.

## Backend
The backend is a FastAPI app in `backend/`. It initializes SQLite on startup, serves health checks, receives uploads, reads POS files, transforms data with pandas, writes Excel outputs with openpyxl, stores upload history and audit records, exposes admin stats and defaults endpoints, supports reprocessing, and deletes upload records with their source, output, and error-report files.

## Data Storage
SQLite stores upload history, audit logs, and column defaults. Uploaded source files are stored in `uploads/`, generated files are stored in `outputs/`, and both runtime folders are ignored by Git. Reprocessing removes the previous generated output before writing the updated result. Deleting a recent upload removes its database row, audit rows, uploaded source file, output file, and error report.

## ERP Output
The standard transformer always returns exactly 12 columns in this order: SI Number, Invoice Date, Product Code, Quantity, Unit Price, Amount, Term Amount, Term Code, Customer Code, Doc Class, Currency Code, and Remarks.

SI Number is generated from the POS Date as `DDMMYYYY`. Invoice Date comes from the POS Date. Product Code defaults to `NA`. Quantity defaults to `1`. Unit Price is computed as `(Net Sales - VAT - VAT Adjustment) / Quantity`. Amount is computed as `Net Sales - VAT - VAT Adjustment`. Term Amount is computed as `VAT + VAT Adjustment`. Term Code defaults to `V`. Customer Code and Doc Class default to `NA`. Currency Code defaults to `PHP`. Remarks come from POS Remarks.

## Defaults
All 12 ERP output columns are configurable in Default Settings. Formula defaults use native POS mapping or computation. String, integer, float, or date defaults override native logic and are marked as overridden in the column summary. Formula rows show as system calculated and cannot edit the value unless the type is changed.

## Template Mode
Template mode lets the user upload a POS file and an ERP output template. The backend reads both files, compares template columns to POS columns, suggests mappings with fuzzy matching, and lets the frontend user confirm or adjust the mapping before generating output.

## File Processing Flow
The user uploads a POS file in Standard mode or uploads POS and template files in Template mode. The backend validates file type and size, saves the source file, detects the real header row, transforms the rows, writes the ERP workbook, stores history and audit data, and returns preview rows plus download links. The frontend shows notices, preview data, and download controls.

## Deployment Direction
The recommended deployment path is Docker Compose on a VPS, office server, or tunnel-backed local machine. Docker is a good fit because this system needs persistent storage for SQLite, uploads, and generated outputs. Phase 6 should add backend and frontend Dockerfiles, a Compose stack, persistent volumes, and an Nginx reverse proxy so friends or coworkers can access the app from outside through a domain, public server IP, or tunnel.

## Constraints
The app currently assumes local or mounted persistent filesystem storage. It is not ready for serverless-only hosting unless SQLite and file storage are replaced with managed database and object storage services. CORS is currently open for development and should be tightened when a production URL is known. Authentication is intentionally not part of the current implementation.

## Future Enhancements
Future work can add authentication, branch-specific default profiles, PostgreSQL, object storage, scheduled cleanup, richer audit views, and direct ERP API integration if ERP access becomes available.

*Last updated: June 2026*
