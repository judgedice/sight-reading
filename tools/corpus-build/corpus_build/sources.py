"""Typed view of sources.yaml."""

from __future__ import annotations

from dataclasses import dataclass, field
from pathlib import Path
from typing import Any

from .paths import SOURCES_YAML, cache_root
from .yamlio import load_yaml


@dataclass(frozen=True)
class Source:
    id: str
    name: str
    url: str
    sha: str
    sparse_mode: str
    sparse_paths: tuple[str, ...]
    score_glob: str
    metadata_files: tuple[str, ...]
    licence_policy: dict[str, Any]
    composer_metadata: str | None
    dedupe_priority: int
    optional: bool = False
    raw: dict[str, Any] = field(default_factory=dict, compare=False, hash=False, repr=False)

    @property
    def repo(self) -> str:
        """owner/name, as used in upstream references (03 section 6.11)."""
        return "/".join(self.url.rstrip("/").split("/")[-2:])

    def dir(self, cache: Path | None = None) -> Path:
        return (cache or cache_root()) / self.id

    def upstream(self, rel_path: str) -> str:
        return f"{self.repo}@{self.sha}:{rel_path}"


def load_sources(path: Path = SOURCES_YAML) -> list[Source]:
    data = load_yaml(path)
    out = []
    for s in data["sources"]:
        out.append(
            Source(
                id=s["id"],
                name=s["name"],
                url=s["url"],
                sha=s["sha"],
                sparse_mode=s["sparse_mode"],
                sparse_paths=tuple(s["sparse_paths"]),
                score_glob=s["score_glob"],
                metadata_files=tuple(s.get("metadata_files") or ()),
                licence_policy=s["licence_policy"],
                composer_metadata=s.get("composer_metadata"),
                dedupe_priority=int(s["dedupe_priority"]),
                optional=bool(s.get("optional", False)),
                raw=s,
            )
        )
    return out


def get_source(sources: list[Source], source_id: str) -> Source:
    for s in sources:
        if s.id == source_id:
            return s
    raise KeyError(source_id)
