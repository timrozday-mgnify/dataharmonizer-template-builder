# DataHarmonizer Template Builder

Browser-based editor for maintaining DataHarmonizer LinkML schemas through an
editable table representation inspired by Schemasheets.

The table model is implemented in `linkml-lib.edit_tables`. It follows
Schemasheets concepts where they are useful for LinkML editing, but it does not
depend on the upstream `schemasheets` Python package or the
`linkml2sheets`/`sheets2linkml` CLI tools at runtime. The reimplementation keeps
conversion in memory for DataHarmonizer's JSON-like row data, exposes the
MIMICC/DataHarmonizer editable subset directly, and avoids subprocess/temp-file
conversion in embedded workflows.

The intended workflow is:

1. Load a LinkML schema.
2. Convert it to editable LinkML tables based on Schemasheets conventions.
3. Display those tables in DataHarmonizer using an editor schema designed for
   editable table rows.
4. Let users edit schema fields, slot usage, annotations, comments, defaults,
   enums, and ordering in a spreadsheet interface.
5. Convert the edited table representation back to LinkML.
6. Optionally rebuild a full DataHarmonizer preview bundle for the session
   in-app (`POST /api/dh-builder/build` + polling
   `GET /api/dh-builder/build/status/{job_id}`, served at `/dh-preview` once
   built — see "DataHarmonizer preview bundle" below), or hand the updated
   schema to a larger application, such as
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
- `src/dataharmonizer_template_builder/` - Django backend (`views.py`) and integration code
- `src/config/` - Django settings/urls/wsgi
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
pre-commit run --all-files
```

## Run Locally

Run the backend and frontend as two local dev servers.

Install the app extra (pulls in `linkml-lib` as a pinned git dependency — no
sibling checkout required):

```bash
python -m pip install -e ".[app]"
```

Backend:

```bash
python manage.py runserver 127.0.0.1:8765
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

No sibling checkouts are required — `DataHarmonizer`, `linkml-lib`, and
`dh-builder` are all pulled at pinned versions during `docker compose build`
(see "Pinned dependency versions" below).

Run:

```bash
docker compose up --build
```

The Compose build pulls the pinned `DataHarmonizer` tag as an additional
build context (frontend library source, also baked into the runtime image
for `dh_compile.py`'s subprocess fallback). `linkml-lib` and `dh-builder-lib`
are pinned pip dependencies (`requirements.txt`), installed straight into the
Python runtime image — no local build context needed for them.

### Testing against Docker Compose

`frontend/tests/app.spec.ts` (the Playwright suite used by `npm run
test:browser`) can run against the real built container instead of the
`npm run dev` + `python manage.py runserver` pair `playwright.config.ts` uses
by default. Set `COMPOSE_TEST_URL` and Playwright skips spawning either dev
process, pointing straight at the already-running compose stack:

```bash
make test-compose
```

This builds the image, brings up the stack, runs the full suite against it,
and tears the stack down afterward (`scripts/test_compose.sh`) — slower than
the dev-server run (image build included), but it's the one place that
exercises the actual container artifact `docker-compose.yml` produces.

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
POST /api/dh-builder/build                       {"session_id": "..."}  -> {"job_id": "..."}
GET  /api/dh-builder/build/status/{job_id}?since=N   (poll until "done": true)
                                                  -> {"lines": [...], "next": N, "done": bool, "result": {...}|null}
```

Poll `status` repeatedly, passing the last response's `next` back as `since`
to fetch only the new lines, until `done` is `true`.

Once a rebuild completes, the bundle is served at `/dh-preview/`. This
requires the Docker-in-Docker mounts in `docker-compose.yml` (the app
container needs the host's `docker.sock` to spawn the sibling container) and
the `dh-builder` image built once (shared with `mimicc-ena-submission-assistant`
if you also run that app — no need to build it twice):

```bash
git clone --branch v0.1.0 https://github.com/timrozday-mgnify/dh-builder.git ../dh-builder
docker build -f ../dh-builder/Dockerfile \
  --build-context dataharmonizer-src=https://github.com/timrozday-mgnify/DataHarmonizer.git#v2.1.0-mimicc \
  -t dh-builder ../dh-builder
```

To stop the Compose stack:

```bash
docker compose down
```

If it is running in the foreground, `Ctrl-C` also stops the running process;
then run `docker compose down` to remove the container and network.

### Pinned dependency versions

All sibling-repo code is pulled at a fixed git tag, never a local checkout or
`main`/`master`. The pins live in two places:

- **`requirements.txt`** (and `pyproject.toml`'s `app` extra) —
  `linkml-lib` and `dh-builder-lib` as
  `name @ git+https://github.com/timrozday-mgnify/<repo>.git@<tag>` lines.
- **`docker-compose.yml`** — the `app` service's
  `build.additional_contexts.dataharmonizer-src` git URL
  (`...git#<tag>`); the manual `dh-builder` image build command above pins
  the same way.

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
