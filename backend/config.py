from pathlib import Path
from typing import Final

from dotenv import load_dotenv


BACKEND_DIR: Final[Path] = Path(__file__).resolve().parent
PROJECT_ROOT: Final[Path] = BACKEND_DIR.parent
ENV_FILE: Final[Path] = BACKEND_DIR / ".env"
ENV_EXAMPLE_FILE: Final[Path] = BACKEND_DIR / ".env.example"

load_dotenv(ENV_FILE if ENV_FILE.exists() else ENV_EXAMPLE_FILE)


def _get_required(name: str) -> str:
    from os import getenv

    value = getenv(name)
    if value is None or value.strip() == "":
        raise RuntimeError(f"Missing required environment variable: {name}")
    return value


def _get_required_int(name: str) -> int:
    value = _get_required(name)
    try:
        return int(value)
    except ValueError as exc:
        raise RuntimeError(f"Environment variable {name} must be an integer") from exc


def _resolve_project_path(value: str) -> str:
    path = Path(value)
    if path.is_absolute():
        return str(path)
    return str((PROJECT_ROOT / path).resolve())


UPLOAD_DIR: str = _resolve_project_path(_get_required("UPLOAD_DIR"))
OUTPUT_DIR: str = _resolve_project_path(_get_required("OUTPUT_DIR"))
DATABASE_URL: str = _resolve_project_path(_get_required("DATABASE_URL"))
MAX_FILE_SIZE_MB: int = _get_required_int("MAX_FILE_SIZE_MB")
ALLOWED_EXTENSIONS: list[str] = [
    extension.strip().lower()
    for extension in _get_required("ALLOWED_EXTENSIONS").split(",")
    if extension.strip()
]
SECRET_KEY: str = _get_required("SECRET_KEY")
ACCESS_TOKEN_EXPIRE_HOURS: int = _get_required_int("ACCESS_TOKEN_EXPIRE_HOURS")

Path(UPLOAD_DIR).mkdir(parents=True, exist_ok=True)
Path(OUTPUT_DIR).mkdir(parents=True, exist_ok=True)
