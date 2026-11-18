"""Per-file data blobs shared by the read, normalize and extract stages (job C3a, C4).

Stage records (JSON Lines, schemas/candidate.schema.json) say what happened to each file and part. The bulky score data
(measures and events) lives beside them in `build/<stage>/data/<corpus>/<digest>.json.gz` and is referenced from the
records by `dataRef` (a path relative to the build root). Blobs are written with sorted keys and a zero gzip mtime, so
a rerun is byte-identical. Later stages (C5) load them with `load_blob` / `load_part`.
"""

from __future__ import annotations

import gzip
import hashlib
import json
from pathlib import Path
from typing import Any


def digest(file_id: str) -> str:
    return hashlib.sha1(file_id.encode("utf-8")).hexdigest()[:16]


def blob_ref(stage: str, corpus: str, file_id: str) -> str:
    return f"{stage}/data/{corpus}/{digest(file_id)}.json.gz"


def write_blob(build: Path, ref: str, data: Any) -> None:
    p = build / ref
    p.parent.mkdir(parents=True, exist_ok=True)
    raw = json.dumps(data, sort_keys=True, ensure_ascii=False, separators=(",", ":")).encode("utf-8")
    with open(p, "wb") as f:
        with gzip.GzipFile(filename="", mode="wb", fileobj=f, mtime=0, compresslevel=6) as g:
            g.write(raw)


def load_blob(build: Path, ref: str) -> Any:
    with gzip.open(build / ref, "rb") as f:
        return json.loads(f.read().decode("utf-8"))


def load_part(build: Path, record: dict[str, Any]) -> dict[str, Any]:
    """Load the normalized part a stage record (kind=part, stage normalize or extract) points to."""
    blob = load_blob(build, record["dataRef"])
    return blob["parts"][str(record["partIndex"])]
