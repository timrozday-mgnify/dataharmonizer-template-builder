"""Load and dump LinkML YAML while preserving practical authoring order."""

from __future__ import annotations

from typing import Any

import yaml


class LinkMLDumper(yaml.SafeDumper):
    """YAML dumper for readable LinkML output."""


def _represent_str(dumper: yaml.SafeDumper, data: str) -> yaml.nodes.ScalarNode:
    style = "|" if "\n" in data else None
    return dumper.represent_scalar("tag:yaml.org,2002:str", data, style=style)


LinkMLDumper.add_representer(str, _represent_str)


def load_yaml_text(yaml_text: str) -> dict[str, Any]:
    """Parse LinkML YAML text into a dictionary."""
    loaded = yaml.safe_load(yaml_text)
    if not isinstance(loaded, dict):
        raise ValueError("Expected a LinkML YAML mapping at the document root.")
    return loaded


def dump_yaml(schema: dict[str, Any]) -> str:
    """Return readable LinkML YAML for a schema dictionary."""
    return yaml.dump(
        schema,
        Dumper=LinkMLDumper,
        allow_unicode=True,
        default_flow_style=False,
        sort_keys=False,
        width=120,
    )
