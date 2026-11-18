"""Locations: the tool directory, the clone cache (outside the repo) and the stage output directory."""

from __future__ import annotations

import os
from pathlib import Path

TOOL_DIR = Path(__file__).resolve().parent.parent
CONFIG_DIR = TOOL_DIR / "config"
SCHEMA_DIR = TOOL_DIR / "schemas"
SOURCES_YAML = TOOL_DIR / "sources.yaml"
LOCK_YAML = TOOL_DIR / "sources.lock.yaml"
COMPOSERS_YAML = TOOL_DIR / "composers.yaml"
COMPOSERS_EXTRA_YAML = TOOL_DIR / "composers-extra.yaml"
DENYLIST_YAML = TOOL_DIR / "denylist.yaml"

CACHE_ENV = "SIGHT_READING_CORPUS_CACHE"
BUILD_ENV = "SIGHT_READING_CORPUS_BUILD"
DEFAULT_CACHE = "~/.cache/sight-reading-corpus"


def cache_root(override: str | os.PathLike | None = None) -> Path:
    """Clone cache. Order: explicit argument, $SIGHT_READING_CORPUS_CACHE, ~/.cache/sight-reading-corpus."""
    raw = override or os.environ.get(CACHE_ENV) or DEFAULT_CACHE
    return Path(raw).expanduser().resolve()


def build_root(override: str | os.PathLike | None = None) -> Path:
    """Stage output root (git-ignored). Order: explicit argument, $SIGHT_READING_CORPUS_BUILD, tools/corpus-build/build."""
    raw = override or os.environ.get(BUILD_ENV)
    return Path(raw).expanduser().resolve() if raw else TOOL_DIR / "build"
