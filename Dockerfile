FROM node:20-slim AS frontend-builder

WORKDIR /app
COPY --from=dataharmonizer-src . /DataHarmonizer
# DataHarmonizer's own node_modules aren't part of its git source (gitignored),
# so they have to be installed here rather than assumed present — this only
# worked before by accident, when dataharmonizer-src was a local checkout that
# happened to already have node_modules from a manual `yarn install`. Matches
# dh-builder's dh_build_steps.sh, which installs DataHarmonizer's deps the
# same way.
RUN cd /DataHarmonizer && yarn install --frozen-lockfile
COPY package.json ./
RUN npm install
COPY index.html tsconfig.json vite.config.ts playwright.config.ts ./
COPY frontend/ frontend/
RUN npm run build

FROM python:3.11-slim

# docker CLI is required so the app can spawn the dh-builder sibling
# container via the mounted docker socket (on-demand DH bundle rebuild).
RUN apt-get update && apt-get install -y docker.io && rm -rf /var/lib/apt/lists/*

WORKDIR /app
# DataHarmonizer source, also needed at runtime (not just by the frontend
# build above) for dh_compile.py's subprocess fallback (DATAHARMONIZER_DIR).
COPY --from=dataharmonizer-src . /DataHarmonizer
# linkml-lib and dh-builder-lib are pinned pip dependencies (see
# requirements.txt) — no local build context needed for them.
COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt

COPY src/ src/
COPY manage.py pyproject.toml README.md ./
COPY --from=frontend-builder /app/frontend/dist frontend/dist

ENV PYTHONPATH=/app/src
EXPOSE 8765
# --workers 1: session state (sessions.py's SessionStore) and build job
# status (views.py's _jobs) are plain in-process dicts, not shared across
# workers — same single-process assumption the previous uvicorn deployment
# already had.
CMD ["gunicorn", "config.wsgi:application", "--bind", "0.0.0.0:8765", "--workers", "1"]
