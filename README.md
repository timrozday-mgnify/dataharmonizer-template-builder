# DataHarmonizer Template Builder

Browser-based editor for maintaining DataHarmonizer LinkML schemas through a
Schemasheets table representation.

The intended workflow is:

1. Load a LinkML schema.
2. Convert it to Schemasheets tables.
3. Display those tables in DataHarmonizer using an editor schema designed for
   Schemasheets rows.
4. Let users edit schema fields, slot usage, annotations, comments, defaults,
   enums, and ordering in a spreadsheet interface.
5. Convert the edited Schemasheets representation back to LinkML.
6. Optionally rebuild a full DataHarmonizer preview bundle for the session
   in-app (`POST /api/dh-builder/build` + `GET /api/dh-builder/build/stream/{job_id}`,
   served at `/dh-preview` once built — see "DataHarmonizer preview bundle"
   below), or hand the updated schema to a larger application, such as
   `../mimicc-ena-submission-assistant`, for rebuilding embedded
   DataHarmonizer templates there instead.

The app can run standalone or be embedded by a larger local project. Host
projects can provide LinkML YAML through HTTP or iframe messages and retrieve
generated LinkML YAML without this project writing into host directories.

## Local Context

The first integration target is the MIMICC ENA submission workflow:

- DataHarmonizer fork: `../DataHarmonizer`, branch `feature/formulas`
- shared LinkML utilities: `../linkml-lib`
- MIMICC assistant: `../mimicc-ena-submission-assistant`
- MIMICC schema source:
  `../ena-submission-dataharmonizer/schemas/mimicc_sample_experiment.yaml`

The DataHarmonizer checkout is expected to expose an expanded browser API via
`window.dataHarmonizer`, including export/import behavior used by the MIMICC
assistant.

## Repository Layout

- `docs/` - product, integration, and schema coverage notes
- `scripts/` - repository maintenance scripts
- `src/dataharmonizer_template_builder/` - FastAPI backend and integration code
- `../linkml-lib/src/linkml_lib/` - shared LinkML conversion, diagnostics, and
  DataHarmonizer schema compilation utilities
- `tests/` - backend test suite

## Development Checks

The repo uses local pre-commit hooks so initial checks can run without fetching
remote hook repositories:

```bash
pre-commit install
pre-commit run --all-files
```

The same checks can be run directly:

```bash
python scripts/check_repo.py
```

## Run Locally

Run the backend and frontend as two local dev servers.

Install the shared sibling library first:

```bash
python -m pip install -e ../linkml-lib
```

Backend:

```bash
PYTHONPATH=src:../linkml-lib/src uvicorn dataharmonizer_template_builder.api:app --host 127.0.0.1 --port 8765
```

Frontend:

```bash
npm install
npm run dev -- --port 5173
```

Open:

```text
http://127.0.0.1:5173/
```

The Vite dev server proxies `/api` calls to `http://127.0.0.1:8765`.

To stop the local servers, press `Ctrl-C` in each terminal where the backend
and frontend commands are running.

## Run With Docker Compose

Yes. Docker Compose can run the app as a single container serving the built
frontend and backend at:

```text
http://127.0.0.1:8765/
```

Prerequisites:

- Docker with BuildKit / Compose support for `additional_contexts`
- sibling DataHarmonizer checkout at `../DataHarmonizer`
- sibling shared library checkout at `../linkml-lib`
- sibling [dh-builder](https://github.com/timrozday-mgnify/dh-builder)
  checkout at `../dh-builder`, needed for the on-demand preview-bundle
  rebuild (see "DataHarmonizer preview bundle" below)

Run:

```bash
docker compose up --build
```

The Compose build passes `../DataHarmonizer`, `../linkml-lib`, and
`../dh-builder` into the image as additional build contexts. The app installs
`linkml-lib` and `dh_builder_lib` into the Python runtime image and uses
DataHarmonizer as the frontend library source.

## DataHarmonizer preview bundle

Beyond the in-process `schema.json` compile (`dh_compile.py`), the app can
trigger a full DataHarmonizer web bundle rebuild (webpack build, not just the
schema compile) for a session, via a sibling Docker container — the same
on-demand-rebuild pattern `mimicc-ena-submission-assistant` uses, sharing the
exact same [dh-builder](https://github.com/timrozday-mgnify/dh-builder) image
(built locally as `dh-builder`, run here with
`TEMPLATE=template_builder_preview` — `mimicc-ena-submission-assistant` runs
the identical image with `TEMPLATE=mimicc`):

```text
POST /api/dh-builder/build              {"session_id": "..."}  -> {"job_id": "..."}
GET  /api/dh-builder/build/stream/{job_id}   (SSE: log lines, then {"done": true, "result": {...}})
```

Once a rebuild completes, the bundle is served at `/dh-preview/`. This
requires the Docker-in-Docker mounts in `docker-compose.yml` (the app
container needs the host's `docker.sock` to spawn the sibling container) and
the `dh-builder` image built once (shared with `mimicc-ena-submission-assistant`
if you also run that app — no need to build it twice):

```bash
git clone https://github.com/timrozday-mgnify/dh-builder.git ../dh-builder
docker build -f ../dh-builder/Dockerfile \
  --build-context dataharmonizer-src=../DataHarmonizer \
  -t dh-builder ../dh-builder
```

To stop the Compose stack:

```bash
docker compose down
```

If it is running in the foreground, `Ctrl-C` also stops the running process;
then run `docker compose down` to remove the container and network.

## Host Integration

Host-facing API:

```text
POST /api/integrations/sessions
PUT  /api/integrations/sessions/{session_id}/tables
GET  /api/integrations/sessions/{session_id}/yaml
GET  /api/frontend-config
```

Typical flow for a larger app:

1. Send current LinkML YAML to `POST /api/integrations/sessions`.
2. Let the user edit and preview in this UI.
3. Request generated LinkML from `GET /api/integrations/sessions/{session_id}/yaml`.
4. Rebuild or persist the schema in the host app.

The frontend can be configured by setting `DHTB_FRONTEND_CONFIG_JSON`. For an
embedded host-managed workflow:

```bash
export DHTB_FRONTEND_CONFIG_JSON='{
  "showImportButton": false,
  "showExportButton": false,
  "showGenerateButton": true,
  "showPreviewButton": true,
  "showDiagnostics": true,
  "allowExampleSchema": false,
  "hostName": "MIMICC ENA Submission Assistant",
  "hostMode": "embedded"
}'
```

When embedded in an iframe, the browser UI accepts:

```js
iframe.contentWindow.postMessage({
  type: "dhtb.loadYaml",
  yaml,
  name: "mimicc_sample",
  sourceId: "mimicc:schema"
}, "*");

iframe.contentWindow.postMessage({ type: "dhtb.exportYaml" }, "*");
```

It replies with `dhtb.loaded`, `dhtb.exported`, `dhtb.state`,
`dhtb.changed`, or `dhtb.error` messages.

For `../mimicc-ena-submission-assistant`, the returned YAML can be passed to
its existing `/api/dh/build` endpoint as `schema_yaml`.

## Current Status

- Browser schema-table editor with enum workspace.
- Python backend conversion API.
- DataHarmonizer schema preview with native DataHarmonizer validation toolbar.
- Host integration HTTP API and iframe message bridge.
