# Docker Deployment

This deployment runs the ERP Formatter as three containers:

- `backend`: FastAPI and SQLite access
- `frontend`: built Next.js production server
- `nginx`: single public HTTP endpoint for the browser

Runtime data is mounted on the host under `runtime/`:

- `runtime/db/db.sqlite3`
- `runtime/uploads/`
- `runtime/outputs/`

Do not commit `.env`, `backend/.env`, `runtime/`, uploads, outputs, databases, or generated workbooks. Rotate `SECRET_KEY` before sharing the app outside your machine.

## Local Setup

From the project root:

```powershell
Copy-Item .env.example .env
```

Edit `.env` and replace `SECRET_KEY` with a long random value.

Start the stack:

```powershell
docker compose up -d --build
```

Open:

```text
http://localhost:8080
```

Check the public Nginx health route:

```powershell
curl http://localhost:8080/health
```

Expected response:

```json
{"status":"ok","service":"erp-formatter"}
```

## Daily Commands

Rebuild after code changes:

```powershell
docker compose up -d --build
```

View logs:

```powershell
docker compose logs -f
```

View one service:

```powershell
docker compose logs -f backend
docker compose logs -f frontend
docker compose logs -f nginx
```

Stop without deleting persisted files:

```powershell
docker compose down
```

Restart:

```powershell
docker compose up -d
```

## Persistence

The Compose file maps backend storage to host folders:

```text
UPLOAD_DIR=/data/uploads      -> ./runtime/uploads
OUTPUT_DIR=/data/outputs      -> ./runtime/outputs
DATABASE_URL=/data/db.sqlite3 -> ./runtime/db/db.sqlite3
```

`docker compose down` stops containers but keeps `runtime/`. Upload history, default settings, uploaded files, and generated output files should still be present after `docker compose up -d`.

## Backup

Stop the stack before taking a clean SQLite backup:

```powershell
docker compose down
Compress-Archive -Path runtime -DestinationPath erp-formatter-runtime-backup.zip -Force
docker compose up -d
```

For Linux servers:

```bash
docker compose down
tar -czf erp-formatter-runtime-backup.tgz runtime
docker compose up -d
```

## Restore

Stop the stack, replace `runtime/`, then start again:

```powershell
docker compose down
Remove-Item -Recurse -Force runtime
Expand-Archive erp-formatter-runtime-backup.zip -DestinationPath .
docker compose up -d
```

For Linux servers:

```bash
docker compose down
rm -rf runtime
tar -xzf erp-formatter-runtime-backup.tgz
docker compose up -d
```

## Update

Pull or copy the new project files, keep the existing `.env` and `runtime/`, then rebuild:

```powershell
docker compose down
docker compose up -d --build
docker compose logs -f
```

Run the health check and test upload, preview, download, reprocess, delete, and Default Settings after each update.

## Internet Access

The app has no authentication in Phase 6. Only expose it to people you trust, and prefer HTTPS plus a restricted audience.

### Recommended: VPS With Domain

1. Create a small VPS and install Docker plus Docker Compose.
2. Copy this project to the VPS.
3. Copy `.env.example` to `.env` and rotate `SECRET_KEY`.
4. Point a domain or subdomain `A` record to the VPS public IP.
5. Open firewall ports `80` and `443` only. Keep SSH restricted to your IP if possible.
6. Run `docker compose up -d --build`.
7. Put HTTPS in front of this stack. Common choices are Cloudflare proxy, a host-level Caddy/Traefik reverse proxy, or a VPS provider load balancer.
8. Visit `http://your-domain/health` or `https://your-domain/health`, depending on the TLS layer you choose.

If this Compose stack is the only web service on the VPS, set `ERP_FORMATTER_HTTP_PORT=80` in `.env`. If another reverse proxy owns ports `80` and `443`, leave this app on `8080` and proxy to `http://127.0.0.1:8080`.

### Office Server Or LAN

1. Install Docker on the office server.
2. Run `docker compose up -d --build`.
3. Allow inbound traffic to the configured port, default `8080`, from trusted network ranges.
4. Open `http://SERVER_IP:8080` from another machine on the same network.

### Quick Temporary Sharing: Tunnel

Use this when you want a short-lived public URL without changing router or firewall settings.

Cloudflare Tunnel example:

```bash
cloudflared tunnel --url http://localhost:8080
```

ngrok example:

```bash
ngrok http 8080
```

Share the generated HTTPS URL only with trusted users. Stop the tunnel when sharing is finished.

## Environment

Compose reads root `.env` values automatically:

```text
ERP_FORMATTER_HTTP_PORT=8080
MAX_FILE_SIZE_MB=10
ALLOWED_EXTENSIONS=xlsx,xls,csv
SECRET_KEY=replace-with-a-long-random-value-before-sharing
ACCESS_TOKEN_EXPIRE_HOURS=24
```

Backend paths are fixed inside Docker so they point at persistent mounted storage. Do not change `UPLOAD_DIR`, `OUTPUT_DIR`, or `DATABASE_URL` for the Compose deployment unless you also update the volume mounts.
