from __future__ import annotations

import os
import sys
from dataclasses import dataclass
from pathlib import Path


def _expand_path(value: str) -> str:
    return os.path.expandvars(os.path.expanduser(value.strip()))


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
        os.environ.setdefault(key, _expand_path(value))


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


def _resolve_log_path(env_prefix: str, default_linux: str) -> str:
    """
    Resolve a per-platform log directory from env vars.
    env_prefix examples: 'CONDUIT_LOG', 'ASSEMBLY_LOG', 'SYSTEM_LOG'
    Env vars checked: WIN_<prefix>_PATH, LINUX_<prefix>_PATH, MAC_<prefix>_PATH
    Falls back to PROGRAMS_DIR/../logs/<suffix> if nothing set.
    """
    explicit = os.getenv(f"{env_prefix}_PATH", "").strip()
    if explicit:
        return _expand_path(explicit)

    platform = sys.platform
    if platform == "win32":
        val = os.getenv(f"WIN_{env_prefix}_PATH", "").strip()
        return _expand_path(val if val else default_linux)
    if platform == "darwin":
        val = os.getenv(f"MAC_{env_prefix}_PATH", "").strip()
        return _expand_path(val if val else str(Path(__file__).resolve().parent / "logs" / env_prefix.lower().replace("_log", "")))
    val = os.getenv(f"LINUX_{env_prefix}_PATH", "").strip()
    return _expand_path(val if val else default_linux)


def _resolve_mes_config_file() -> str:
    """
    Resolve the MES config JSON file path.
    Env vars: MAC_MES_CONFIG, WIN_MES_CONFIG, LINUX_MES_CONFIG (no _PATH suffix).
    """
    explicit = os.getenv("MES_CONFIG_FILE", "").strip()
    if explicit:
        return _expand_path(explicit)

    platform = sys.platform
    if platform == "win32":
        val = os.getenv("WIN_MES_CONFIG", "").strip()
        return _expand_path(val if val else r"C:\Users\Melvin Venceslass\APP_ENV\mes_config.json")
    if platform == "darwin":
        val = os.getenv("MAC_MES_CONFIG", "").strip()
        return _expand_path(val if val else str(Path(__file__).resolve().parent / "mes_config.json"))
    val = os.getenv("LINUX_MES_CONFIG", "").strip()
    return _expand_path(val if val else "/home/mviis/mes_config.json")


def _resolve_programs_dir() -> str:
    """
    Priority:
      1. PROGRAMS_DIR env var (explicit override, any platform)
      2. Platform-specific env var: WIN_PROGRAMS_DIR / LINUX_PROGRAMS_DIR / MAC_PROGRAMS_DIR
      3. Hardcoded per-platform default
    """
    explicit = os.getenv("PROGRAMS_DIR", "").strip()
    if explicit:
        return _expand_path(explicit)

    platform = sys.platform  # 'win32', 'linux', 'darwin'

    if platform == "win32":
        val = os.getenv("WIN_PROGRAMS_DIR", "").strip()
        return _expand_path(val if val else r"C:\Users\Melvin Venceslass\APP_ENV\programs")

    if platform == "darwin":
        val = os.getenv("MAC_PROGRAMS_DIR", "").strip()
        if val:
            return _expand_path(val)
        # default: <project_dir>/programs for macOS when not set
        return _expand_path(str(Path(__file__).resolve().parent / "programs"))

    # linux and everything else
    val = os.getenv("LINUX_PROGRAMS_DIR", "").strip()
    return _expand_path(val if val else "/home/mviis/programs")


@dataclass(frozen=True)
class Settings:
    app_name: str = os.getenv("APP_NAME", "Program Editor")
    host: str = os.getenv("HOST", "0.0.0.0")
    port: int = _as_int("PORT", 8080)
    debug: bool = _as_bool("DEBUG", False)

    programs_dir: str = _resolve_programs_dir()

    conduit_log_path: str = _resolve_log_path("CONDUIT_LOG", "/home/mviis/conduit_log")
    assembly_log_path: str = _resolve_log_path("ASSEMBLY_LOG", "/home/mviis/assy_log")
    system_log_path: str = _resolve_log_path("SYSTEM_LOG", "/home/mviis/logs/log")

    mes_config_file: str = _resolve_mes_config_file()


settings = Settings()

