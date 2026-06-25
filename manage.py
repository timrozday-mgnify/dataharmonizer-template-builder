#!/usr/bin/env python
"""Django management entrypoint."""

import os
import sys

sys.path.insert(0, os.path.join(os.path.dirname(os.path.abspath(__file__)), "src"))
os.environ.setdefault("DJANGO_SETTINGS_MODULE", "config.settings")

if __name__ == "__main__":
    from django.core.management import execute_from_command_line

    execute_from_command_line(sys.argv)
