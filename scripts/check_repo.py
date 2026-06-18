#!/usr/bin/env python3
"""Lightweight repository hygiene checks used by pre-commit."""

from __future__ import annotations

import pathlib
import sys


ROOT = pathlib.Path(__file__).resolve().parents[1]
SKIP_DIRS = {
    ".git",
    ".mypy_cache",
    ".pytest_cache",
    ".ruff_cache",
    ".venv",
    "__pycache__",
    "build",
    "dist",
    "node_modules",
    "playwright-report",
    "test-results",
    "venv",
}
TEXT_SUFFIXES = {
    ".cfg",
    ".css",
    ".html",
    ".js",
    ".json",
    ".md",
    ".py",
    ".toml",
    ".ts",
    ".tsx",
    ".txt",
    ".yaml",
    ".yml",
}


def iter_text_files() -> list[pathlib.Path]:
    files: list[pathlib.Path] = []
    for path in ROOT.rglob("*"):
        if any(part in SKIP_DIRS for part in path.relative_to(ROOT).parts):
            continue
        if path.is_file() and (
            path.suffix in TEXT_SUFFIXES or path.name in {"AGENTS.md", "README.md"}
        ):
            files.append(path)
    return files


def check_file(path: pathlib.Path) -> list[str]:
    errors: list[str] = []
    try:
        text = path.read_text(encoding="utf-8")
    except UnicodeDecodeError as exc:
        return [f"{path}: cannot decode as UTF-8: {exc}"]

    rel = path.relative_to(ROOT)
    if text and not text.endswith("\n"):
        errors.append(f"{rel}: missing final newline")

    for line_number, line in enumerate(text.splitlines(), start=1):
        if line.rstrip(" \t") != line:
            errors.append(f"{rel}:{line_number}: trailing whitespace")

    return errors


def main() -> int:
    errors: list[str] = []
    for path in iter_text_files():
        errors.extend(check_file(path))

    if errors:
        print("\n".join(errors), file=sys.stderr)
        return 1
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
