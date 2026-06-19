import {
  Copy,
  Download,
  Eye,
  FileInput,
  ListChecks,
  Maximize2,
  Minimize2,
  Plus,
  RefreshCw,
  Search,
  Table2,
  Trash2
} from 'lucide-react';
import { useEffect, useMemo, useRef, useState } from 'react';

import { createIntegrationSession, generateSchema, getFrontendConfig } from './api';
import { loadDataHarmonizerLibrary } from './dataHarmonizerLibrary';
import type { AppContext } from 'data-harmonizer';
import type { Diagnostic, FrontendConfig, GenerateResponse, ImportResponse, Row, Tables } from './types';

const EXAMPLE_SCHEMA = `id: https://example.org/template-builder-demo
name: template_builder_demo
title: Template Builder Demo
imports:
- linkml:types
prefixes:
  linkml: https://w3id.org/linkml/
default_range: string
classes:
  dh_interface:
    description: A DataHarmonizer interface
  Demo:
    title: Demo
    is_a: dh_interface
    slots:
    - sample_id
    - status
    slot_usage:
      sample_id:
        rank: 1
        slot_group: Identifiers
      status:
        rank: 2
        slot_group: Status
slots:
  sample_id:
    title: Sample ID
    range: string
    required: true
  status:
    title: Status
    range: StatusMenu
    required: true
enums:
  StatusMenu:
    permissible_values:
      draft:
        text: draft
      ready:
        text: ready
`;

const TABLE_ORDER = ['schema', 'classes', 'slots', 'enums', 'permissible_values', 'annotations'];
const ENUM_WORKSPACE = '__enum_workspace';
const DEFAULT_FRONTEND_CONFIG: FrontendConfig = {
  showImportButton: true,
  showExportButton: true,
  showGenerateButton: true,
  showPreviewButton: true,
  showDiagnostics: true,
  allowExampleSchema: true,
  hostName: '',
  hostMode: 'standalone'
};

export function App() {
  const [yamlInput, setYamlInput] = useState(EXAMPLE_SCHEMA);
  const [sessionId, setSessionId] = useState('');
  const [schemaName, setSchemaName] = useState('');
  const [tables, setTables] = useState<Tables>({});
  const [activeTable, setActiveTable] = useState('slots');
  const [selectedEnum, setSelectedEnum] = useState('');
  const [diagnostics, setDiagnostics] = useState<Diagnostic[]>([]);
  const [generated, setGenerated] = useState<GenerateResponse | null>(null);
  const [previewGenerated, setPreviewGenerated] = useState<GenerateResponse | null>(null);
  const [maximizedPane, setMaximizedPane] = useState<'table' | 'preview' | null>(null);
  const [openPopup, setOpenPopup] = useState<'import' | 'export' | null>(null);
  const [frontendConfig, setFrontendConfig] = useState<FrontendConfig>(DEFAULT_FRONTEND_CONFIG);
  const [busy, setBusy] = useState(false);
  const tableNames = useMemo(
    () => TABLE_ORDER.filter((name) => tables[name]).concat(Object.keys(tables).filter((name) => !TABLE_ORDER.includes(name))),
    [tables]
  );
  const enumNames = useMemo(() => new Set((tables.enums ?? []).map((row) => cellText(row.enum)).filter(Boolean)), [tables]);

  useEffect(() => {
    let cancelled = false;
    getFrontendConfig()
      .then((config) => {
        if (cancelled) return;
        setFrontendConfig({ ...DEFAULT_FRONTEND_CONFIG, ...config });
        if (!config.allowExampleSchema && !sessionId) {
          setYamlInput('');
        }
      })
      .catch(() => {
        if (!cancelled) setFrontendConfig(DEFAULT_FRONTEND_CONFIG);
      });
    return () => {
      cancelled = true;
    };
  }, [sessionId]);

  useEffect(() => {
    const readyMessage = {
      type: 'dhtb.ready',
      config: frontendConfig,
      sessionId,
      schemaName
    };
    window.parent?.postMessage(readyMessage, '*');
  }, [frontendConfig, schemaName, sessionId]);

  useEffect(() => {
    function reply(event: MessageEvent, payload: Record<string, unknown>) {
      const targetOrigin = event.origin === 'null' ? '*' : event.origin;
      event.source?.postMessage(payload, { targetOrigin });
    }

    async function handleMessage(event: MessageEvent) {
      const data = event.data as Record<string, unknown> | null;
      if (!data || typeof data !== 'object' || typeof data.type !== 'string' || !data.type.startsWith('dhtb.')) {
        return;
      }
      try {
        if (data.type === 'dhtb.loadYaml') {
          if (typeof data.yaml !== 'string') {
            throw new Error('dhtb.loadYaml requires a yaml string.');
          }
          const response = await loadYaml(data.yaml, {
            name: typeof data.name === 'string' ? data.name : undefined,
            sourceId: typeof data.sourceId === 'string' ? data.sourceId : undefined,
            metadata: isRecord(data.metadata) ? data.metadata : undefined
          });
          reply(event, {
            type: 'dhtb.loaded',
            sessionId: response.session_id,
            schemaName: response.schema_name,
            diagnostics: response.diagnostics
          });
        } else if (data.type === 'dhtb.exportYaml') {
          const response = await generateCurrentYaml();
          if (!response) throw new Error('No schema session is loaded.');
          reply(event, {
            type: 'dhtb.exported',
            sessionId,
            schemaName,
            yaml: response.yaml,
            schema: response.schema,
            schema_json: response.schema_json,
            diagnostics: response.diagnostics
          });
        } else if (data.type === 'dhtb.getState') {
          reply(event, {
            type: 'dhtb.state',
            sessionId,
            schemaName,
            diagnostics,
            dirty: Boolean(sessionId && !generated)
          });
        }
      } catch (error) {
        reply(event, {
          type: 'dhtb.error',
          message: error instanceof Error ? error.message : String(error)
        });
      }
    }

    window.addEventListener('message', handleMessage);
    return () => window.removeEventListener('message', handleMessage);
  }, [diagnostics, generated, loadYaml, generateCurrentYaml, schemaName, sessionId]);

  function applyImportResponse(response: ImportResponse, yaml: string) {
    setYamlInput(yaml);
    setSessionId(response.session_id);
    setSchemaName(response.schema_name);
    setTables(response.tables);
    setDiagnostics(response.diagnostics);
    setGenerated(null);
    setPreviewGenerated(null);
    setOpenPopup(null);
    setActiveTable(response.tables.slots ? 'slots' : Object.keys(response.tables)[0] ?? '');
    setSelectedEnum(firstReferencedEnum(response.tables) || cellText(response.tables.enums?.[0]?.enum));
  }

  async function loadYaml(
    yaml: string,
    options: { name?: string; sourceId?: string; metadata?: Record<string, unknown> } = {}
  ): Promise<ImportResponse> {
    setBusy(true);
    try {
      const response = await createIntegrationSession({ yaml, ...options });
      applyImportResponse(response, yaml);
      return response;
    } finally {
      setBusy(false);
    }
  }

  async function onImport() {
    await loadYaml(yamlInput);
  }

  async function generateCurrentYaml({ updatePreview = false } = {}): Promise<GenerateResponse | null> {
    if (!sessionId) return null;
    setBusy(true);
    try {
      const response = await generateSchema(sessionId, tables);
      setGenerated(response);
      if (updatePreview) {
        setPreviewGenerated(response);
      }
      setDiagnostics(response.diagnostics);
      return response;
    } finally {
      setBusy(false);
    }
  }

  async function onGenerate() {
    await generateCurrentYaml();
  }

  async function onPreview() {
    await generateCurrentYaml({ updatePreview: true });
  }

  function updateRows(tableName: string, rows: Row[]) {
    setTables((current) => ({ ...current, [tableName]: rows }));
    setGenerated(null);
    window.parent?.postMessage({ type: 'dhtb.changed', sessionId, schemaName }, '*');
  }

  function openEnum(enumName: string) {
    setSelectedEnum(enumName);
    setActiveTable(ENUM_WORKSPACE);
  }

  return (
    <main className="app-shell">
      <aside className="sidebar">
        <div>
          <p className="eyebrow">LinkML to Schemasheets</p>
          <h1>Template Builder</h1>
          {frontendConfig.hostName ? <p className="host-name">{frontendConfig.hostName}</p> : null}
        </div>
        <div className="schema-name">{schemaName || 'No schema loaded'}</div>
        {frontendConfig.showImportButton ? <button className="primary command" onClick={() => setOpenPopup('import')} disabled={busy}>
          <FileInput size={18} /> Import YAML
        </button> : null}
        {frontendConfig.showGenerateButton ? <button className="command" onClick={onGenerate} disabled={!sessionId || busy}>
          <RefreshCw size={18} /> Generate
        </button> : null}
        {frontendConfig.showPreviewButton ? <button className="command" onClick={onPreview} disabled={!sessionId || busy}>
          <Eye size={18} /> Preview
        </button> : null}
        {frontendConfig.showExportButton ? <button className="command" onClick={() => setOpenPopup('export')} disabled={busy}>
          <Download size={18} /> Export YAML
        </button> : null}
        <nav className="table-nav" aria-label="Tables">
          {tables.enums ? (
            <button
              className={activeTable === ENUM_WORKSPACE ? 'selected' : ''}
              onClick={() => setActiveTable(ENUM_WORKSPACE)}
            >
              <ListChecks size={15} /> Enum workspace
            </button>
          ) : null}
          {tableNames.map((name) => (
            <button
              key={name}
              className={name === activeTable ? 'selected' : ''}
              onClick={() => setActiveTable(name)}
            >
              <Table2 size={15} /> {name.replaceAll('_', ' ')}
            </button>
          ))}
        </nav>
      </aside>

      <section className="workspace">
        <div className="workspace-toolbar">
          {frontendConfig.showImportButton ? <button className="compact" onClick={() => setOpenPopup('import')} disabled={busy}>
            <FileInput size={15} /> Import YAML
          </button> : null}
          {frontendConfig.showExportButton ? <button className="compact" onClick={() => setOpenPopup('export')} disabled={busy}>
            <Download size={15} /> Export YAML
          </button> : null}
          {frontendConfig.showDiagnostics ? <div className="io-diagnostics">
            <Diagnostics diagnostics={diagnostics} />
          </div> : null}
        </div>

        <div className={`split-workspace ${maximizedPane ? `max-${maximizedPane}` : ''}`}>
        <div className="panel table-panel">
          <div className="panel-heading">
            <h2>{activeTable === ENUM_WORKSPACE ? 'Enum workspace' : activeTable ? activeTable.replaceAll('_', ' ') : 'Tables'}</h2>
            <div className="heading-actions">
              {activeTable === ENUM_WORKSPACE ? <ListChecks size={18} /> : <Table2 size={18} />}
              <button
                className="icon-button"
                onClick={() => setMaximizedPane(maximizedPane === 'table' ? null : 'table')}
                aria-label={maximizedPane === 'table' ? 'Restore table panel' : 'Maximize table panel'}
                title={maximizedPane === 'table' ? 'Restore' : 'Maximize'}
              >
                {maximizedPane === 'table' ? <Minimize2 size={16} /> : <Maximize2 size={16} />}
              </button>
            </div>
          </div>
          {activeTable === ENUM_WORKSPACE ? (
            <EnumWorkspace
              tables={tables}
              selectedEnum={selectedEnum}
              onSelectEnum={setSelectedEnum}
              onChange={setTables}
            />
          ) : activeTable && tables[activeTable] ? (
            <EditableTable
              rows={tables[activeTable]}
              onChange={(rows) => updateRows(activeTable, rows)}
              enumNames={enumNames}
              onOpenEnum={openEnum}
            />
          ) : (
            <div className="empty-state">
              {frontendConfig.allowExampleSchema ? 'Import a schema.' : 'Waiting for schema from host.'}
            </div>
          )}
        </div>

        <div className="panel preview-panel">
          <div className="panel-heading">
            <h2>Preview</h2>
            <div className="heading-actions">
              <Eye size={18} />
              <button
                className="icon-button"
                onClick={() => setMaximizedPane(maximizedPane === 'preview' ? null : 'preview')}
                aria-label={maximizedPane === 'preview' ? 'Restore preview panel' : 'Maximize preview panel'}
                title={maximizedPane === 'preview' ? 'Restore' : 'Maximize'}
              >
                {maximizedPane === 'preview' ? <Minimize2 size={16} /> : <Maximize2 size={16} />}
              </button>
            </div>
          </div>
          <Preview generated={previewGenerated} />
        </div>
        </div>
      </section>
      {openPopup === 'import' && frontendConfig.showImportButton ? (
        <div className="popup-backdrop" role="presentation" onMouseDown={() => setOpenPopup(null)}>
          <section className="popup-panel" role="dialog" aria-modal="true" aria-label="Import YAML" onMouseDown={(event) => event.stopPropagation()}>
            <div className="popup-heading">
              <h2>Import YAML</h2>
              <button className="icon-button" onClick={() => setOpenPopup(null)} aria-label="Close import YAML panel">
                <Minimize2 size={16} />
              </button>
            </div>
            <textarea
              className="popup-textarea"
              value={yamlInput}
              onChange={(event) => setYamlInput(event.target.value)}
            />
            <div className="popup-actions">
              <button className="primary command" onClick={onImport} disabled={busy}>
                <FileInput size={18} /> Load schema
              </button>
            </div>
          </section>
        </div>
      ) : null}
      {openPopup === 'export' && frontendConfig.showExportButton ? (
        <div className="popup-backdrop" role="presentation" onMouseDown={() => setOpenPopup(null)}>
          <section className="popup-panel" role="dialog" aria-modal="true" aria-label="Export YAML" onMouseDown={(event) => event.stopPropagation()}>
            <div className="popup-heading">
              <h2>Export YAML</h2>
              <button className="icon-button" onClick={() => setOpenPopup(null)} aria-label="Close export YAML panel">
                <Minimize2 size={16} />
              </button>
            </div>
            <textarea className="popup-textarea generated-output" readOnly value={generated?.yaml ?? ''} />
            <div className="popup-actions">
              <button className="command" onClick={onGenerate} disabled={!sessionId || busy}>
                <RefreshCw size={18} /> Generate
              </button>
            </div>
          </section>
        </div>
      ) : null}
    </main>
  );
}

function EditableTable({
  rows,
  onChange,
  enumNames = new Set(),
  onOpenEnum
}: {
  rows: Row[];
  onChange: (rows: Row[]) => void;
  enumNames?: Set<string>;
  onOpenEnum?: (enumName: string) => void;
}) {
  const columns = useMemo(() => {
    const names = new Set<string>();
    rows.forEach((row) => Object.keys(row).forEach((key) => names.add(key)));
    return [...names];
  }, [rows]);

  function updateCell(rowIndex: number, column: string, value: string) {
    const nextRows = rows.map((row, index) => (index === rowIndex ? { ...row, [column]: value } : row));
    onChange(nextRows);
  }

  function addRow() {
    onChange([...rows, Object.fromEntries(columns.map((column) => [column, '']))]);
  }

  if (!rows.length) {
    return (
      <div className="empty-state">
        <button className="command" onClick={addRow}>
          Add row
        </button>
      </div>
    );
  }

  return (
    <div className="table-wrap">
      <table>
        <thead>
          <tr>
            {columns.map((column) => (
              <th key={column}>{column.replaceAll('_', ' ')}</th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map((row, rowIndex) => (
            <tr key={rowIndex}>
              {columns.map((column) => (
                <td key={column}>
                  {column === 'range' && enumNames.has(cellText(row[column])) && onOpenEnum ? (
                    <div className="range-cell">
                      <input
                        value={String(row[column] ?? '')}
                        onChange={(event) => updateCell(rowIndex, column, event.target.value)}
                      />
                      <button className="enum-cell-link" onClick={() => onOpenEnum(cellText(row[column]))}>
                        {cellText(row[column])}
                      </button>
                    </div>
                  ) : (
                    <input
                      value={String(row[column] ?? '')}
                      onChange={(event) => updateCell(rowIndex, column, event.target.value)}
                    />
                  )}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
      <button className="compact" onClick={addRow}>
        Add row
      </button>
    </div>
  );
}

function EnumWorkspace({
  tables,
  selectedEnum,
  onSelectEnum,
  onChange
}: {
  tables: Tables;
  selectedEnum: string;
  onSelectEnum: (enumName: string) => void;
  onChange: (tables: Tables) => void;
}) {
  const [search, setSearch] = useState('');
  const [selectedValue, setSelectedValue] = useState('');
  const enumRows = tables.enums ?? [];
  const valueRows = tables.permissible_values ?? [];
  const slotRows = tables.slots ?? [];
  const effectiveEnum = selectedEnum && enumRows.some((row) => cellText(row.enum) === selectedEnum)
    ? selectedEnum
    : cellText(enumRows[0]?.enum);
  const enumRow = enumRows.find((row) => cellText(row.enum) === effectiveEnum);
  const enumValueRows = valueRows
    .map((row, sourceIndex) => ({ row, sourceIndex }))
    .filter(({ row }) => cellText(row.enum) === effectiveEnum);
  const visibleValueRows = enumValueRows.filter(({ row }) => enumRowMatches(row, search));
  const referenceCounts = enumReferenceCounts(tables);
  const warnings = enumWarnings(tables);

  useEffect(() => {
    if (effectiveEnum && effectiveEnum !== selectedEnum) {
      onSelectEnum(effectiveEnum);
    }
  }, [effectiveEnum, onSelectEnum, selectedEnum]);

  useEffect(() => {
    if (!visibleValueRows.some(({ row }) => cellText(row.permissible_value) === selectedValue)) {
      setSelectedValue(cellText(visibleValueRows[0]?.row.permissible_value));
    }
  }, [selectedValue, visibleValueRows]);

  function patchTables(nextTables: Tables) {
    onChange(nextTables);
  }

  function updateEnumField(column: string, value: string) {
    patchTables({
      ...tables,
      enums: enumRows.map((row) =>
        cellText(row.enum) === effectiveEnum ? { ...row, [column]: value } : row
      )
    });
  }

  function renameEnum(nextName: string) {
    const cleanName = nextName.trim();
    if (!effectiveEnum || !cleanName || cleanName === effectiveEnum) return;
    patchTables({
      ...tables,
      enums: enumRows.map((row) =>
        cellText(row.enum) === effectiveEnum ? { ...row, enum: cleanName } : row
      ),
      permissible_values: valueRows.map((row) =>
        cellText(row.enum) === effectiveEnum ? { ...row, enum: cleanName } : row
      ),
      slots: slotRows.map((row) =>
        cellText(row.range) === effectiveEnum ? { ...row, range: cleanName } : row
      )
    });
    onSelectEnum(cleanName);
  }

  function addValue() {
    if (!effectiveEnum) return;
    const value = uniqueValueKey(enumValueRows.map(({ row }) => row), 'new_value');
    patchTables({
      ...tables,
      permissible_values: [
        ...valueRows,
        { enum: effectiveEnum, permissible_value: value, text: value, description: '', meaning: '', comments: '' }
      ]
    });
    setSelectedValue(value);
  }

  function duplicateValue() {
    const source = enumValueRows.find(({ row }) => cellText(row.permissible_value) === selectedValue)?.row;
    if (!source || !effectiveEnum) return;
    const value = uniqueValueKey(enumValueRows.map(({ row }) => row), `${cellText(source.permissible_value)}_copy`);
    patchTables({
      ...tables,
      permissible_values: [...valueRows, { ...source, permissible_value: value, text: value, enum: effectiveEnum }]
    });
    setSelectedValue(value);
  }

  function deleteValue() {
    if (!effectiveEnum || !selectedValue) return;
    patchTables({
      ...tables,
      permissible_values: valueRows.filter(
        (row) => !(cellText(row.enum) === effectiveEnum && cellText(row.permissible_value) === selectedValue)
      )
    });
  }

  function updateValue(sourceIndex: number, column: string, value: string) {
    patchTables({
      ...tables,
      permissible_values: valueRows.map((row, index) =>
        index === sourceIndex ? { ...row, [column]: value } : row
      )
    });
    if (column === 'permissible_value') {
      setSelectedValue(value);
    }
  }

  if (!enumRows.length) {
    return <div className="empty-state">No enums in this schema.</div>;
  }

  return (
    <div className="enum-workspace">
      <aside className="enum-browser" aria-label="Enums">
        {enumRows.map((row) => {
          const enumName = cellText(row.enum);
          const valueCount = valueRows.filter((valueRow) => cellText(valueRow.enum) === enumName).length;
          return (
            <button
              key={enumName}
              className={enumName === effectiveEnum ? 'selected' : ''}
              onClick={() => onSelectEnum(enumName)}
            >
              <strong>{enumName}</strong>
              <span>{valueCount} values · {referenceCounts.get(enumName) ?? 0} refs</span>
            </button>
          );
        })}
      </aside>
      <section className="enum-editor">
        <div className="enum-meta">
          <label>
            Name
            <input value={effectiveEnum} onChange={(event) => renameEnum(event.target.value)} />
          </label>
          <label>
            Description
            <input
              value={cellText(enumRow?.description)}
              onChange={(event) => updateEnumField('description', event.target.value)}
            />
          </label>
          <label>
            Annotations
            <input
              value={cellText(enumRow?.annotations)}
              onChange={(event) => updateEnumField('annotations', event.target.value)}
            />
          </label>
        </div>
        {warnings.length ? (
          <div className="enum-warnings">
            {warnings.map((warning) => (
              <div className="diagnostic warning" key={warning}>{warning}</div>
            ))}
          </div>
        ) : null}
        <div className="enum-toolbar">
          <label className="search-box">
            <Search size={15} />
            <input value={search} onChange={(event) => setSearch(event.target.value)} />
          </label>
          <span>{visibleValueRows.length} / {enumValueRows.length}</span>
          <button className="compact" onClick={addValue}><Plus size={15} /> Add</button>
          <button className="compact" onClick={duplicateValue} disabled={!selectedValue}><Copy size={15} /> Duplicate</button>
          <button className="compact danger" onClick={deleteValue} disabled={!selectedValue}><Trash2 size={15} /> Delete</button>
        </div>
        <div className="enum-values table-wrap">
          <table>
            <thead>
              <tr>
                {['permissible_value', 'text', 'description', 'meaning', 'comments'].map((column) => (
                  <th key={column}>{column.replaceAll('_', ' ')}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {visibleValueRows.map(({ row, sourceIndex }) => {
                const valueKey = cellText(row.permissible_value);
                return (
                  <tr
                    key={sourceIndex}
                    className={valueKey === selectedValue ? 'selected-row' : ''}
                    onClick={() => setSelectedValue(valueKey)}
                  >
                    {['permissible_value', 'text', 'description', 'meaning', 'comments'].map((column) => (
                      <td key={column}>
                        <input
                          value={cellText(row[column])}
                          onChange={(event) => updateValue(sourceIndex, column, event.target.value)}
                        />
                      </td>
                    ))}
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </section>
    </div>
  );
}

function Diagnostics({ diagnostics }: { diagnostics: Diagnostic[] }) {
  if (!diagnostics.length) {
    return <div className="diagnostic ok">No diagnostics.</div>;
  }
  return (
    <div className="diagnostics">
      {diagnostics.map((diagnostic, index) => (
        <div className={`diagnostic ${diagnostic.level}`} key={`${diagnostic.message}-${index}`}>
          <strong>{diagnostic.level}</strong>
          <span>{diagnostic.message}</span>
        </div>
      ))}
    </div>
  );
}

function Preview({
  generated
}: {
  generated: GenerateResponse | null;
}) {
  const contextRef = useRef<PreviewAppContext | null>(null);
  const toolbarRef = useRef<unknown>(null);
  const footerRef = useRef<unknown>(null);
  const [status, setStatus] = useState('idle');
  const [error, setError] = useState('');
  const [previewClass, setPreviewClass] = useState('');

  useEffect(() => {
    let cancelled = false;

    async function loadPreview() {
      if (!generated) {
        setStatus('idle');
        setError('');
        setPreviewClass('');
        return;
      }

      const schema = normalizeSchemaForPreview(generated.schema_json);
      const className = selectPreviewClass(schema);
      if (!className) {
        setStatus('error');
        setError('No previewable DataHarmonizer class was found.');
        setPreviewClass('');
        return;
      }

      setStatus('loading');
      setError('');
      setPreviewClass(className);
      try {
        const { AppContext, Footer, Toolbar } = await loadDataHarmonizerLibrary();
        if (cancelled) return;
        const context =
          contextRef.current instanceof AppContext
            ? contextRef.current
            : new AppContext({ template_path: `local/${className}` });
        contextRef.current = context as PreviewAppContext;
        await context.reload(`local/${className}`, null, schema);
        const toolbarRoot = document.querySelector('#data-harmonizer-toolbar');
        const footerRoot = document.querySelector('#data-harmonizer-footer');
        if (toolbarRoot && !toolbarRef.current) {
          toolbarRef.current = new Toolbar(toolbarRoot, context, {
            templatePath: `local/${className}`,
            getLanguages: context.getLocaleData.bind(context),
            getExportFormats: async () => ({}),
            getSchema: async () => schema
          });
        }
        if (footerRoot && !footerRef.current) {
          footerRef.current = new Footer(footerRoot, context);
        }
        if (cancelled) return;
        window.dispatchEvent(new Event('resize'));
        setStatus('ready');
      } catch (previewError) {
        if (cancelled) return;
        setStatus('error');
        setError(previewError instanceof Error ? previewError.message : String(previewError));
      }
    }

    void loadPreview();

    return () => {
      cancelled = true;
    };
  }, [generated]);

  if (!generated) {
    return <div className="empty-state">Run Preview to load DataHarmonizer.</div>;
  }
  const schema = generated.schema_json;
  const classes = Object.keys((schema.classes as Record<string, unknown>) ?? {});
  const slots = Object.keys((schema.slots as Record<string, unknown>) ?? {});
  return (
    <div className="dh-preview">
      <div className="preview-summary">
        <div>
          <span>Classes</span>
          <strong>{classes.length}</strong>
        </div>
        <div>
          <span>Slots</span>
          <strong>{slots.length}</strong>
        </div>
        <div>
          <span>Preview</span>
          <strong>{status === 'ready' ? previewClass : status}</strong>
        </div>
      </div>
      {error ? <div className="diagnostic error">{error}</div> : null}
      <div className="dh-preview-frame">
        <div id="data-harmonizer-toolbar" />
        <ul id="data-harmonizer-tabs" className="nav nav-tabs" />
        <div id="data-harmonizer-grid" className="tab-content" />
        <div id="data-harmonizer-footer" />
      </div>
    </div>
  );
}

type PreviewAppContext = AppContext & {
  getLocaleData: (template?: unknown) => unknown;
};

function cellText(value: unknown): string {
  return value === null || value === undefined ? '' : String(value);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function firstReferencedEnum(tables: Tables): string {
  const enumNames = new Set((tables.enums ?? []).map((row) => cellText(row.enum)).filter(Boolean));
  return cellText((tables.slots ?? []).find((row) => enumNames.has(cellText(row.range)))?.range);
}

function enumReferenceCounts(tables: Tables): Map<string, number> {
  const counts = new Map<string, number>();
  for (const row of tables.enums ?? []) {
    counts.set(cellText(row.enum), 0);
  }
  for (const row of tables.slots ?? []) {
    const range = cellText(row.range);
    if (counts.has(range)) {
      counts.set(range, (counts.get(range) ?? 0) + 1);
    }
  }
  return counts;
}

function enumWarnings(tables: Tables): string[] {
  const enumNames = new Set((tables.enums ?? []).map((row) => cellText(row.enum)).filter(Boolean));
  const warnings: string[] = [];
  for (const row of tables.slots ?? []) {
    const range = cellText(row.range);
    if (range.endsWith('Menu') && !enumNames.has(range)) {
      warnings.push(`Slot ${cellText(row.slot)} references missing enum ${range}.`);
    }
  }
  for (const row of tables.permissible_values ?? []) {
    const enumName = cellText(row.enum);
    if (enumName && !enumNames.has(enumName)) {
      warnings.push(`Permissible value ${cellText(row.permissible_value)} references missing enum ${enumName}.`);
    }
  }
  for (const enumName of enumNames) {
    const seen = new Set<string>();
    for (const row of (tables.permissible_values ?? []).filter((valueRow) => cellText(valueRow.enum) === enumName)) {
      const value = cellText(row.permissible_value);
      if (!value) continue;
      if (seen.has(value)) {
        warnings.push(`Enum ${enumName} contains duplicate value ${value}.`);
      }
      seen.add(value);
    }
  }
  return [...new Set(warnings)];
}

function enumRowMatches(row: Row, search: string): boolean {
  const query = search.trim().toLowerCase();
  if (!query) return true;
  return ['permissible_value', 'text', 'description', 'meaning', 'comments'].some((column) =>
    cellText(row[column]).toLowerCase().includes(query)
  );
}

function uniqueValueKey(rows: Row[], base: string): string {
  const existing = new Set(rows.map((row) => cellText(row.permissible_value)));
  if (!existing.has(base)) return base;
  let index = 2;
  while (existing.has(`${base}_${index}`)) {
    index += 1;
  }
  return `${base}_${index}`;
}

function selectPreviewClass(schema: Record<string, unknown>): string {
  const classes = (schema.classes as Record<string, { is_a?: string }> | undefined) ?? {};
  const dhInterfaceClass = Object.entries(classes).find(([, classDef]) => classDef?.is_a === 'dh_interface');
  if (dhInterfaceClass) return dhInterfaceClass[0];
  return Object.keys(classes).find((className) => !['Container', 'dh_interface'].includes(className)) ?? '';
}

function normalizeSchemaForPreview(schema: Record<string, unknown>): Record<string, unknown> {
  const nextSchema = structuredClone(schema) as Record<string, unknown>;
  const classes = (nextSchema.classes as Record<string, Record<string, unknown>> | undefined) ?? {};
  const slots = (nextSchema.slots as Record<string, Record<string, unknown>> | undefined) ?? {};
  const types = (nextSchema.types as Record<string, Record<string, unknown>> | undefined) ?? {};
  nextSchema.types = {
    string: { name: 'string', uri: 'xsd:string' },
    integer: { name: 'integer', uri: 'xsd:integer' },
    float: { name: 'float', uri: 'xsd:float' },
    double: { name: 'double', uri: 'xsd:double' },
    boolean: { name: 'boolean', uri: 'xsd:boolean' },
    date: { name: 'date', uri: 'xsd:date' },
    datetime: { name: 'datetime', uri: 'xsd:dateTime' },
    time: { name: 'time', uri: 'xsd:time' },
    ...types
  };

  for (const [className, classDef] of Object.entries(classes)) {
    if (className === 'dh_interface' || className === 'Container' || classDef.attributes) continue;
    const slotNames = Array.isArray(classDef.slots) ? classDef.slots.map(String) : [];
    const slotUsage = (classDef.slot_usage as Record<string, Record<string, unknown>> | undefined) ?? {};
    classDef.attributes = Object.fromEntries(
      slotNames.map((slotName) => [
        slotName,
        {
          ...(slots[slotName] ?? {}),
          ...(slotUsage[slotName] ?? {}),
          name: slotName,
          owner: className,
          domain_of: [className]
        }
      ])
    );
  }

  return nextSchema;
}
