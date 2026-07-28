import os
import secrets
import signal
import socket
import sys
import threading
import time
import urllib.error
import urllib.request
import webbrowser
from pathlib import Path


APP_NAME = "ERPFormatter"
HOST = "127.0.0.1"
READINESS_TIMEOUT_SECONDS = 30.0


def _app_data_dir() -> Path:
    if os.name == "nt":
        local_app_data = os.getenv("LOCALAPPDATA")
        if local_app_data:
            return Path(local_app_data) / APP_NAME
    return Path.home() / f".{APP_NAME.lower()}"


def _frontend_dist_dir() -> Path:
    bundle_root = getattr(sys, "_MEIPASS", None)
    if bundle_root:
        return Path(bundle_root) / "frontend" / "out"
    return Path(__file__).resolve().parent.parent / "frontend" / "out"


def _load_or_create_secret(secret_path: Path) -> str:
    if secret_path.is_file():
        existing_secret = secret_path.read_text(encoding="utf-8").strip()
        if existing_secret:
            return existing_secret

    secret = secrets.token_urlsafe(48)
    secret_path.write_text(secret, encoding="utf-8")
    return secret


def _configure_environment() -> Path:
    app_data_dir = _app_data_dir().resolve()
    upload_dir = app_data_dir / "uploads"
    output_dir = app_data_dir / "outputs"
    database_path = app_data_dir / "erp_formatter.sqlite3"
    secret_path = app_data_dir / "secret.key"
    frontend_dist_dir = _frontend_dist_dir().resolve()

    upload_dir.mkdir(parents=True, exist_ok=True)
    output_dir.mkdir(parents=True, exist_ok=True)
    secret_key = _load_or_create_secret(secret_path)

    os.environ.update(
        {
            "UPLOAD_DIR": str(upload_dir),
            "OUTPUT_DIR": str(output_dir),
            "DATABASE_URL": str(database_path),
            "MAX_FILE_SIZE_MB": "10",
            "ALLOWED_EXTENSIONS": "xlsx,xls,csv",
            "SECRET_KEY": secret_key,
            "ACCESS_TOKEN_EXPIRE_HOURS": "24",
            "FRONTEND_DIST_DIR": str(frontend_dist_dir),
        }
    )
    return app_data_dir


def _find_free_port() -> int:
    with socket.socket(socket.AF_INET, socket.SOCK_STREAM) as listener:
        listener.bind((HOST, 0))
        return int(listener.getsockname()[1])


def _wait_until_ready(
    health_url: str,
    server_thread: threading.Thread,
    timeout_seconds: float = READINESS_TIMEOUT_SECONDS,
) -> None:
    deadline = time.monotonic() + timeout_seconds
    while time.monotonic() < deadline:
        if not server_thread.is_alive():
            raise RuntimeError("The local server stopped before it became ready.")
        try:
            with urllib.request.urlopen(health_url, timeout=1.0) as response:
                if response.status == 200:
                    return
        except (OSError, TimeoutError, urllib.error.URLError):
            pass
        time.sleep(0.1)
    raise RuntimeError("Timed out waiting for the local server to start.")


def main() -> None:
    _configure_environment()

    if hasattr(signal, "SIGBREAK"):
        signal.signal(signal.SIGBREAK, signal.default_int_handler)

    import uvicorn

    from main import app

    port = _find_free_port()
    server = uvicorn.Server(
        uvicorn.Config(
            app,
            host=HOST,
            port=port,
            log_level="warning",
        )
    )
    server_thread = threading.Thread(
        target=server.run,
        name="erp-formatter-server",
        daemon=True,
    )
    server_thread.start()

    app_url = f"http://{HOST}:{port}/"
    try:
        _wait_until_ready(f"http://{HOST}:{port}/health", server_thread)
        webbrowser.open(app_url)
        print(f"ERP Formatter is running at {app_url}")
        print("Keep this window open. Close it to quit.")

        while server_thread.is_alive():
            server_thread.join(timeout=0.5)
    except KeyboardInterrupt:
        print("\nStopping ERP Formatter...")
    finally:
        server.should_exit = True
        server_thread.join(timeout=10.0)
        if server_thread.is_alive():
            server.force_exit = True
            server_thread.join(timeout=5.0)


if __name__ == "__main__":
    main()
