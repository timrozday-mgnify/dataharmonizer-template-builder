#!/usr/bin/env bash
set -euo pipefail

SCHEMA="${SCHEMA:-/schema/schema.yaml}"
OUTPUT="${OUTPUT:-/output}"
TEMPLATE="${TEMPLATE:-template_builder_preview}"

bash /opt/dh_build_steps.sh /dh-src "$SCHEMA" "$TEMPLATE" "$OUTPUT"
