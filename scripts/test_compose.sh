#!/usr/bin/env bash
# Runs the Playwright suite against the real `docker compose` stack (single
# container serving frontend + backend on :8765) instead of the two-process
# dev setup playwright.config.ts uses by default — see README "Testing
# against Docker Compose".
set -euo pipefail
cd "$(dirname "$0")/.."

trap 'docker compose down -v' EXIT

docker compose up --build -d

url="http://127.0.0.1:8765"
deadline=$((SECONDS + 300))  # image build included
until curl -sf "$url/api/health" >/dev/null; do
  if [ "$SECONDS" -ge "$deadline" ]; then
    echo "composed stack did not become healthy" >&2
    exit 1
  fi
  sleep 1
done

COMPOSE_TEST_URL="$url" npx playwright test
