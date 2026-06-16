# ERP Formatter

Monorepo scaffold for the ERP Formatter internal tool.

## Backend

```powershell
cd backend
copy .env.example .env
pip install -r requirements.txt
uvicorn main:app --reload
```

Health check:

```text
GET http://localhost:8000/health
```

## Frontend

```powershell
cd frontend
npm install
npm run dev
```

Open:

```text
http://localhost:3000
```

## Runtime Files

Uploaded POS files are written to `uploads/`.
Generated ERP files are written to `outputs/`.

Both directories are intentionally ignored by Git.
