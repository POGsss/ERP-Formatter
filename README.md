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

## Docker Deployment

Use this when you want to run the full app through Docker and open it from one local URL.

1. Create the Docker environment file:

```powershell
copy .env.example .env
```

2. Edit `.env` and replace `SECRET_KEY` with a long random value.

3. Build and start backend, frontend, and Nginx:

```powershell
docker compose up -d --build
```

Open:

```text
http://localhost:8080
```

Health check:

```powershell
curl http://localhost:8080/health
```

The Docker stack persists SQLite, uploads, and outputs under `runtime/`, which is ignored by Git.

### Share With Friends

The easiest temporary sharing option is Cloudflare Tunnel through Docker. Keep the main app running, then start a tunnel:

```powershell
docker run -d --name erp-formatter-tunnel cloudflare/cloudflared:latest tunnel --no-autoupdate --url http://host.docker.internal:8080
```

Get the public HTTPS URL:

```powershell
docker logs erp-formatter-tunnel
```

Look for a line like:

```text
https://example-words.trycloudflare.com
```

Send that URL to your friends. The app has no login, so only share it with trusted people.

Stop sharing:

```powershell
docker rm -f erp-formatter-tunnel
```

If you need a fresh URL later:

```powershell
docker rm -f erp-formatter-tunnel
docker run -d --name erp-formatter-tunnel cloudflare/cloudflared:latest tunnel --no-autoupdate --url http://host.docker.internal:8080
docker logs erp-formatter-tunnel
```

Stop the app:

```powershell
docker compose down
```

See [docs/DOCKER_DEPLOYMENT.md](docs/DOCKER_DEPLOYMENT.md) for VPS, domain, firewall, backup, restore, and update steps.
