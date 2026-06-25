"""Command-line entrypoint for the backend server."""

from __future__ import annotations

import os
import sys
from pathlib import Path


def main() -> None:
    """Run the Django development server."""
    sys.path.insert(0, str(Path(__file__).resolve().parent.parent))
    os.environ.setdefault("DJANGO_SETTINGS_MODULE", "config.settings")

    from django.core.management import execute_from_command_line

    execute_from_command_line(["manage.py", "runserver", "127.0.0.1:8765"])


if __name__ == "__main__":
    main()
