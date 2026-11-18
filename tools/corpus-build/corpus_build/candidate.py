"""Candidate JSON Lines: validation against schemas/candidate.schema.json, deterministic writing and reading."""

from __future__ import annotations

import json
from functools import lru_cache
from pathlib import Path
from typing import Any, Iterable

import jsonschema

from .paths import SCHEMA_DIR

SCHEMA_VERSION = 1


@lru_cache(maxsize=1)
def _validator() -> jsonschema.Draft202012Validator:
    with open(SCHEMA_DIR / "candidate.schema.json", encoding="utf-8") as f:
        schema = json.load(f)
    return jsonschema.Draft202012Validator(schema)


def validate(record: dict[str, Any]) -> None:
    """Raise jsonschema.ValidationError (the best match) if the record breaks the candidate schema."""
    errors = list(_validator().iter_errors(record))
    if errors:
        raise jsonschema.exceptions.best_match(errors)  # type: ignore[misc]


def dumps(record: dict[str, Any]) -> str:
    return json.dumps(record, sort_keys=True, ensure_ascii=False, separators=(",", ":"))


def write_jsonl(path: str | Path, records: Iterable[dict[str, Any]]) -> int:
    """Validate and write records sorted by id. Returns the number written. Output is byte-stable."""
    recs = sorted(records, key=lambda r: r["id"])
    for r in recs:
        validate(r)
    p = Path(path)
    p.parent.mkdir(parents=True, exist_ok=True)
    with open(p, "w", encoding="utf-8", newline="\n") as f:
        for r in recs:
            f.write(dumps(r))
            f.write("\n")
    return len(recs)


def read_jsonl(path: str | Path) -> list[dict[str, Any]]:
    with open(path, encoding="utf-8") as f:
        return [json.loads(line) for line in f if line.strip()]


def make_record(stage: str, kind: str, id: str, corpus: str, status: str, **fields: Any) -> dict[str, Any]:
    rec: dict[str, Any] = {"schemaVersion": SCHEMA_VERSION, "stage": stage, "kind": kind, "id": id, "corpus": corpus, "status": status}
    rec.update({k: v for k, v in fields.items() if v is not None})
    return rec
