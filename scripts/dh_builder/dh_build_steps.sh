#!/usr/bin/env bash
set -euo pipefail

DATAHARMONIZER="$1"
SCHEMA="$2"
TEMPLATE="${3:-template_builder_preview}"
OUTPUT="${4:-}"

[ -d "$DATAHARMONIZER" ] || { echo "DataHarmonizer not found at $DATAHARMONIZER" >&2; exit 1; }
[ -f "$SCHEMA" ] || { echo "Schema not found at $SCHEMA" >&2; exit 1; }

TPL_DIR="$DATAHARMONIZER/web/templates/$TEMPLATE"
mkdir -p "$TPL_DIR/source"
cp "$SCHEMA" "$TPL_DIR/source/$TEMPLATE.yaml"

if [ ! -f "$TPL_DIR/export.js" ]; then
  printf 'export default {};\n' > "$TPL_DIR/export.js"
fi

(cd "$TPL_DIR" && python3 "$DATAHARMONIZER/script/linkml.py" --input "source/$TEMPLATE.yaml")

python3 - "$DATAHARMONIZER/web/templates/menu.json" "$TPL_DIR/schema.json" "$TEMPLATE" <<'PY'
import json
import sys

menu_path, schema_path, folder = sys.argv[1:4]
schema_name = json.load(open(schema_path, encoding="utf-8"))["name"]
try:
    menu = json.load(open(menu_path, encoding="utf-8"))
except FileNotFoundError:
    menu = {}
group_key = folder.upper()
group = menu.setdefault(group_key, {"folder": folder, "id": f"https://example.org/{folder}", "version": "1.0.0"})
group["folder"] = folder
group.setdefault("templates", {})[schema_name] = {"name": schema_name, "display": True}
json.dump(menu, open(menu_path, "w", encoding="utf-8"), indent=2)
PY

if [ "${DH_SKIP_BUILD:-}" = "1" ]; then
  exit 0
fi

(cd "$DATAHARMONIZER" && yarn build:web)

(cd "$DATAHARMONIZER/web/templates" && find . -name 'schema.json' -print0) |
  while IFS= read -r -d '' f; do
    dest="$DATAHARMONIZER/web/dist/templates/${f#./}"
    mkdir -p "$(dirname "$dest")"
    cp "$DATAHARMONIZER/web/templates/$f" "$dest"
  done

if [ -n "$OUTPUT" ]; then
  mkdir -p "$OUTPUT"
  cp -R "$DATAHARMONIZER/web/dist/." "$OUTPUT/"
fi
