"""Shared helpers: build tiny local git repositories that look like the three upstream sources, so the fetch, lock
and gate tests need no network and no clone cache."""

from __future__ import annotations

import subprocess
from pathlib import Path
from typing import Any

import pytest

from corpus_build.sources import Source

CC0_TEXT = "Creative Commons Legal Code\n\nCC0 1.0 Universal\n\nStatement of Purpose\n"

COMPOSERS_YAML = """# Parse this file with StrictYAML
111:
  path: Old,_Master
  name: Old Master
  born: 1700
  died: 1770
222:
  path: Edge,_Case_(Alias)
  name: Edge Case
  born: 1860
  died: 1930
333:
  path: Late,_Composer
  name: Late Composer
  born: 1880
  died: 1931
444:
  path: Unknown,_Death
  name: Unknown Death
  born: 1880
  died:
"""


def git(args: list[str], cwd: Path) -> str:
    env = {"GIT_AUTHOR_NAME": "t", "GIT_AUTHOR_EMAIL": "t@example.com", "GIT_COMMITTER_NAME": "t", "GIT_COMMITTER_EMAIL": "t@example.com", "PATH": __import__("os").environ["PATH"], "HOME": str(cwd)}
    return subprocess.run(["git", *args], cwd=cwd, env=env, capture_output=True, text=True, check=True).stdout.strip()


def make_repo(root: Path, name: str, files: dict[str, bytes | str]) -> tuple[Path, str]:
    d = root / "upstream" / name
    d.mkdir(parents=True)
    git(["init", "-q", "-b", "main"], d)
    git(["config", "uploadpack.allowFilter", "true"], d)
    git(["config", "uploadpack.allowAnySHA1InWant", "true"], d)
    for rel, content in files.items():
        p = d / rel
        p.parent.mkdir(parents=True, exist_ok=True)
        p.write_bytes(content if isinstance(content, bytes) else content.encode("utf-8"))
    git(["add", "-A"], d)
    git(["commit", "-q", "-m", "init"], d)
    return d, git(["rev-parse", "HEAD"], d)


def ly(license_line: str, composer: str = "Traditional", source: str = "Old Book, 1895", extra: str = "") -> str:
    return f'\\version "2.18.2"\n\\header {{\n  title = "T"\n  composer = "{composer}"\n  source = "{source}"\n  {license_line}\n  maintainer = "M"\n{extra}}}\n{{ c\'4 }}\n'


def openscore_source(sid: str, repo: Path, sha: str, composer_metadata: str | None = "data/composers.yaml") -> Source:
    raw: dict[str, Any] = {}
    return Source(
        id=sid, name=sid, url=f"file://{repo}", sha=sha, sparse_mode="no-cone",
        sparse_paths=("/scores/**/*.mxl", "/data/*.yaml", "/LICENSE.txt"), score_glob="scores/**/*.mxl",
        metadata_files=("data/composers.yaml",),
        licence_policy={"kind": "repository", "licence": "CC0-1.0", "evidence_file": "LICENSE.txt", "evidence_text": "CC0 1.0 Universal"},
        composer_metadata=composer_metadata, dedupe_priority=1, raw=raw,
    )


def mutopia_source(repo: Path, sha: str) -> Source:
    return Source(
        id="mutopia", name="Mutopia", url=f"file://{repo}", sha=sha, sparse_mode="cone",
        sparse_paths=("ftp/Traditional", "ftp/Anonymous", "ftp/MasonL"), score_glob="ftp/**/*.ly", metadata_files=(),
        licence_policy={"kind": "file-header", "fields": ["license", "copyright"]}, composer_metadata=None, dedupe_priority=3, optional=True,
    )


@pytest.fixture()
def world(tmp_path: Path) -> dict[str, Any]:
    """Two OpenScore-like repos and a Mutopia-like repo, cloned into a cache with a lock, ready for the gate."""
    score = b"PK\x03\x04 not a real mxl, the gate never parses it"
    lieder, lsha = make_repo(tmp_path, "lieder", {
        "LICENSE.txt": CC0_TEXT,
        "data/composers.yaml": COMPOSERS_YAML,
        "scores/Old,_Master/Set/Song_A/lc1.mxl": score,
        "scores/Old,_Master/Set/Song_B/lc2.mxl": score + b"2",
        "scores/Edge,_Case/Set/Song/lc3.mxl": score + b"3",
        "scores/Late,_Composer/Set/Song/lc4.mxl": score + b"4",
        "scores/Unknown,_Death/Set/Song/lc5.mxl": score + b"5",
        "scores/Nobody,_Listed/Set/Song/lc6.mxl": score + b"6",
        "scores/readme.txt": "ignored",
    })
    quartets, qsha = make_repo(tmp_path, "quartets", {
        "LICENSE.txt": CC0_TEXT,
        "data/composers.yaml": COMPOSERS_YAML,
        "scores/Old,_Master/Quartet_1/sq1.mxl": score + b"q",
    })
    mutopia, msha = make_repo(tmp_path, "mutopia", {
        "ftp/Traditional/pd/pd.ly": ly('license = "Public Domain"'),
        "ftp/Traditional/by4/by4.ly": ly('license = "Creative Commons Attribution 4.0"'),
        "ftp/Traditional/by25/by25.ly": ly('copyright = "Creative Commons Attribution 2.5"'),
        "ftp/Traditional/bysa/bysa.ly": ly('license = "Creative Commons Attribution-ShareAlike 4.0"'),
        "ftp/Traditional/noyear/noyear.ly": ly('license = "Public Domain"', source="www.cyberhymnal.org"),
        "ftp/Traditional/late/late.ly": ly('license = "Public Domain"', source="Some Press, 1962"),
        "ftp/Traditional/arr/arr.ly": ly('license = "Public Domain"', composer="Arr. Y. Nobody"),
        "ftp/Traditional/nolic/nolic.ly": ly(""),
        "ftp/MasonL/hymn/hymn.ly": ly('license = "Public Domain"', composer="Lowell Mason", source="Handbook"),
    })
    cache = tmp_path / "cache"
    sources = [openscore_source("openscore-lieder", lieder, lsha), openscore_source("openscore-quartets", quartets, qsha), mutopia_source(mutopia, msha)]
    return {"root": tmp_path, "cache": cache, "sources": sources, "build": tmp_path / "build", "lock_path": tmp_path / "lock.yaml", "repos": {"lieder": lieder, "quartets": quartets, "mutopia": mutopia}}
