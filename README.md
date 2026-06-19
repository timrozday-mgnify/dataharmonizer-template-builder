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
6. Hand the updated schema to a larger application, such as
   `../mimicc-ena-submission-assistant`, for rebuilding embedded
   DataHarmonizer templates.

The app can run standalone or be embedded by a larger local project. Host
projects can provide LinkML YAML through HTTP or iframe messages and retrieve
generated LinkML YAML without this project writing into host directories.

## Local Context

The first integration target is the MIMICC ENA submission workflow:

- DataHarmonizer fork: `../DataHarmonizer`, branch `feature/formulas`
- MIMICC assistant: `../mimicc-ena-submission-assistant`
- MIMICC schema source:
  `../ena-submission-dataharmonizer/schemas/mimicc_sample_experiment.yaml`

The DataHarmonizer checkout is expected to expose an expanded browser API via
`window.dataHarmonizer`, including export/import behavior used by the MIMICC
assistant.

## Repository Layout

- `docs/` - product, integration, and schema coverage notes
- `scripts/` - repository maintenance scripts
- `src/dataharmonizer_template_builder/` - placeholder Python package for future
  conversion/server code
- `tests/` - placeholder test suite

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

Backend:

```bash
PYTHONPATH=src uvicorn dataharmonizer_template_builder.api:app --host 127.0.0.1 --port 8765
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

Run:

```bash
docker compose up --build
```

The Compose build passes `../DataHarmonizer` into the image as the
`dataharmonizer-src` build context so the frontend can import DataHarmonizer and
the backend can use `script/linkml.py` for preview schema compilation.

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
