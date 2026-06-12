"""Environment-aware runtime settings for PVOS.

The defaults keep the package easy to run locally. Tests and hosted deployments can
redirect all mutable state without touching the checked-in project directories.
"""

from __future__ import annotations

import os
from pathlib import Path
from typing import List

BASE_DIR = Path(__file__).resolve().parent.parent


def _path_from_env(name: str, default: Path) -> Path:
    raw = os.environ.get(name)
    return Path(raw).expanduser().resolve() if raw else default.resolve()


DATA_DIR = _path_from_env("PVOS_DATA_DIR", BASE_DIR / "data")
UPLOADS_DIR = _path_from_env("PVOS_UPLOADS_DIR", BASE_DIR / "uploads")
PRIVATE_ASSETS_DIR = _path_from_env("PVOS_PRIVATE_ASSETS_DIR", DATA_DIR / "private_assets")
DB_PATH = _path_from_env("PVOS_DB_PATH", DATA_DIR / "pvos_lite.db")
LIBRARY_PATH = _path_from_env("PVOS_LIBRARY_PATH", BASE_DIR / "library" / "canonical_library.json")

for directory in {DATA_DIR, UPLOADS_DIR, PRIVATE_ASSETS_DIR, DB_PATH.parent}:
    directory.mkdir(parents=True, exist_ok=True)


def cors_origins() -> List[str]:
    """Return the explicit CORS allow-list.

    Hosted mode should normally use same-origin requests and therefore needs no
    wildcard. These loopback origins are retained for local development.
    """

    raw = os.environ.get("PVOS_CORS_ORIGINS", "http://127.0.0.1:4173,http://localhost:4173")
    return [item.strip() for item in raw.split(",") if item.strip()]


def expose_storage_paths() -> bool:
    return os.environ.get("PVOS_EXPOSE_STORAGE_PATHS", "false").lower() in {"1", "true", "yes"}
