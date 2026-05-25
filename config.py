from __future__ import annotations

import os
from dataclasses import dataclass
from pathlib import Path


def _load_dotenv_file() -> None:
    env_path = Path(__file__).resolve().parent / ".env"
    if not env_path.exists() or not env_path.is_file():
        return

    for line in env_path.read_text(encoding="utf-8").splitlines():
        stripped = line.strip()
        if not stripped or stripped.startswith("#") or "=" not in stripped:
            continue
        key, value = stripped.split("=", 1)
        key = key.strip()
        if not key:
            continue
        os.environ.setdefault(key, value.strip())


_load_dotenv_file()


def _as_int(name: str, default: int) -> int:
    raw = os.getenv(name)
    if raw is None or raw.strip() == "":
        return default
    try:
        return int(raw)
    except ValueError:
        return default


def _as_bool(name: str, default: bool = False) -> bool:
    raw = os.getenv(name)
    if raw is None:
        return default
    return raw.strip().lower() in {"1", "true", "yes", "y", "on"}


@dataclass(frozen=True)
class Settings:
    app_name: str = os.getenv("APP_NAME", "Program Editor")
    host: str = os.getenv("HOST", "0.0.0.0")
    port: int = _as_int("PORT", 8080)
    debug: bool = _as_bool("DEBUG", False)

    gcs_bucket_name: str = os.getenv("GCS_BUCKET_NAME", "").strip()
    gcs_prefix: str = os.getenv("GCS_PREFIX", "program_editor").strip("/ ")
    gcs_key_file: str = os.getenv("GCS_KEY_FILE", "/app/bucket_key.json").strip()
    gcs_upload_expiry_seconds: int = _as_int("GCS_UPLOAD_EXPIRY_SECONDS", 900)
    gcs_direct_upload_threshold_bytes: int = _as_int(
        "GCS_DIRECT_UPLOAD_THRESHOLD_BYTES",
        20 * 1024 * 1024,
    )


settings = Settings()
