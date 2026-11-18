"""YAML helpers. Our own config is read with typed safe loading. OpenScore's data files are StrictYAML, in which
every scalar is a string, so they are read with a loader that does no implicit typing (a composer named "No" or a
key like 60159846 must stay a string)."""

from __future__ import annotations

from pathlib import Path
from typing import Any

import yaml


class _StringLoader(yaml.SafeLoader):
    pass


# Drop every implicit resolver: all plain scalars stay str.
_StringLoader.yaml_implicit_resolvers = {}


def load_yaml(path: str | Path) -> Any:
    with open(path, encoding="utf-8") as f:
        return yaml.safe_load(f)


def load_strict_strings(path: str | Path) -> Any:
    with open(path, encoding="utf-8") as f:
        return yaml.load(f, Loader=_StringLoader)  # noqa: S506 (SafeLoader subclass)


def dump_yaml(data: Any, header: str = "") -> str:
    body = yaml.safe_dump(data, sort_keys=True, allow_unicode=True, default_flow_style=False, width=120)
    if header:
        header = "".join(f"# {line}\n" if line else "#\n" for line in header.splitlines())
    return header + body


def write_yaml(path: str | Path, data: Any, header: str = "") -> None:
    Path(path).write_text(dump_yaml(data, header), encoding="utf-8")
