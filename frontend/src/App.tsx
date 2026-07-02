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
import { textRenderer } from 'handsontable/renderers/textRenderer';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';

import { createIntegrationSession, generateSchema, getFrontendConfig } from './api';
import { loadDataHarmonizerLibrary } from './dataHarmonizerLibrary';
import { DataGrid } from './DataGrid';
import { syncTables } from './tableSync';
import type { AppContext } from 'data-harmonizer';
import type { Diagnostic, EditLocation, FrontendConfig, GenerateResponse, ImportResponse, Row, Tables } from './types';

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
const SLOT_PINNED_COLUMNS = ['slot', 'rank'];
const ENUM_VALUE_COLUMNS = ['permissible_value', 'text', 'description', 'meaning', 'comments'];
const HISTORY_LIMIT = 100;
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

type HistoryEntry = {
  beforeTables: Tables;
  afterTables: Tables;
  location?: EditLocation;
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
  const historyRef = useRef<{ undo: HistoryEntry[]; redo: HistoryEntry[] }>({ undo: [], redo: [] });
  const schemaEditorHasFocusRef = useRef(false);
  const [focusLocation, setFocusLocation] = useState<EditLocation | null>(null);
  const tableNames = useMemo(
    () => TABLE_ORDER.filter((name) => tables[name]).concat(Object.keys(tables).filter((name) => !TABLE_ORDER.includes(name))),
    [tables]
  );
  const enumNames = useMemo(() => new Set((tables.enums ?? []).map((row) => cellText(row.enum)).filter(Boolean)), [tables]);

  const resetHistory = useCallback(() => {
    historyRef.current = { undo: [], redo: [] };
    setFocusLocation(null);
  }, []);

  const markChanged = useCallback(() => {
    setGenerated(null);
    setPreviewGenerated(null);
    window.parent?.postMessage({ type: 'dhtb.changed', sessionId, schemaName }, '*');
  }, [schemaName, sessionId]);

  const navigateToEdit = useCallback((location?: EditLocation) => {
    if (!location) return;
    setActiveTable(location.tableName);
    if (location.enumName) {
      setSelectedEnum(location.enumName);
    }
    setFocusLocation(location);
  }, []);

  const commitTables = useCallback((nextTables: Tables, sourceTable?: string, location?: EditLocation) => {
    setTables((current) => {
      const syncedTables = syncTables(current, nextTables, { sourceTable });
      if (tablesEqual(current, syncedTables)) return current;
      const entry: HistoryEntry = {
        beforeTables: cloneTables(current),
        afterTables: cloneTables(syncedTables),
        location
      };
      const undo = [...historyRef.current.undo, entry].slice(-HISTORY_LIMIT);
      historyRef.current = { undo, redo: [] };
      markChanged();
      return syncedTables;
    });
  }, [markChanged]);

  const applyHistoryTables = useCallback((nextTables: Tables, location?: EditLocation) => {
    setTables(cloneTables(nextTables));
    markChanged();
    navigateToEdit(location);
  }, [markChanged, navigateToEdit]);

  const undoTables = useCallback(() => {
    const entry = historyRef.current.undo.at(-1);
    if (!entry) return;
    historyRef.current = {
      undo: historyRef.current.undo.slice(0, -1),
      redo: [...historyRef.current.redo, entry]
    };
    applyHistoryTables(entry.beforeTables, entry.location);
  }, [applyHistoryTables]);

  const redoTables = useCallback(() => {
    const entry = historyRef.current.redo.at(-1);
    if (!entry) return;
    historyRef.current = {
      undo: [...historyRef.current.undo, entry],
      redo: historyRef.current.redo.slice(0, -1)
    };
    applyHistoryTables(entry.afterTables, entry.location);
  }, [applyHistoryTables]);

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
    const media = window.matchMedia('(prefers-color-scheme: dark)');
    function applyFallbackTheme() {
      document.documentElement.setAttribute('data-theme', media.matches ? 'dark' : 'light');
    }
    applyFallbackTheme();
    media.addEventListener('change', applyFallbackTheme);
    return () => media.removeEventListener('change', applyFallbackTheme);
  }, []);

  useEffect(() => {
    function preventHorizontalNavigation(event: WheelEvent) {
      if (!event.cancelable || Math.abs(event.deltaX) <= Math.abs(event.deltaY)) return;
      if (!canScrollHorizontally(event.target, event.deltaX)) {
        event.preventDefault();
      }
    }

    window.addEventListener('wheel', preventHorizontalNavigation, { passive: false });
    return () => window.removeEventListener('wheel', preventHorizontalNavigation);
  }, []);

  useEffect(() => {
    function handleUndoRedoShortcut(event: KeyboardEvent) {
      if (!sessionId || !isUndoRedoShortcut(event)) return;
      const target = event.target;
      const activeElement = document.activeElement;
      const hasTableFocus =
        target instanceof Element && target.closest('.table-panel') ||
        activeElement instanceof Element && activeElement.closest('.table-panel') ||
        schemaEditorHasFocusRef.current;
      if (!hasTableFocus) return;
      if (target instanceof Element && isTextEditingTarget(target)) return;
      event.preventDefault();
      if (isRedoShortcut(event)) {
        redoTables();
      } else {
        undoTables();
      }
    }

    window.addEventListener('keydown', handleUndoRedoShortcut, true);
    return () => window.removeEventListener('keydown', handleUndoRedoShortcut, true);
  }, [redoTables, sessionId, undoTables]);

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
        } else if (data.type === 'dhtb.setTheme') {
          if (data.theme === 'dark' || data.theme === 'light') {
            document.documentElement.setAttribute('data-theme', data.theme);
          }
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
    resetHistory();
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
      resetHistory();
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

  const updateRows = useCallback((tableName: string, rows: Row[], location?: EditLocation) => {
    commitTables({ ...tables, [tableName]: rows }, tableName, location ?? { tableName });
  }, [commitTables, tables]);
  const updateTables = useCallback((nextTables: Tables, sourceTable?: string, location?: EditLocation) => {
    commitTables(nextTables, sourceTable, location ?? (sourceTable ? { tableName: sourceTable } : undefined));
  }, [commitTables]);
  const updateActiveTableRows = useCallback(
    (rows: Row[], location?: EditLocation) => updateRows(activeTable, rows, location ?? { tableName: activeTable }),
    [activeTable, updateRows]
  );

  const openEnum = useCallback((enumName: string) => {
    setSelectedEnum(enumName);
    setActiveTable(ENUM_WORKSPACE);
  }, []);

  return (
    <>
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
        <div
          className="panel table-panel"
          onFocusCapture={() => {
            schemaEditorHasFocusRef.current = true;
          }}
          onMouseDownCapture={() => {
            schemaEditorHasFocusRef.current = true;
          }}
        >
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
              onChange={updateTables}
              focusLocation={focusLocation}
            />
          ) : activeTable && tables[activeTable] ? (
            <EditableTable
              tableName={activeTable}
              rows={tables[activeTable]}
              onChange={updateActiveTableRows}
              enumNames={enumNames}
              onOpenEnum={openEnum}
              focusLocation={focusLocation}
            />
          ) : (
            <div className="empty-state">
              {frontendConfig.allowExampleSchema ? 'Import a schema.' : 'Waiting for schema from host.'}
            </div>
          )}
        </div>

        <div
          className="panel preview-panel"
          onFocusCapture={() => {
            schemaEditorHasFocusRef.current = false;
          }}
          onMouseDownCapture={() => {
            schemaEditorHasFocusRef.current = false;
          }}
        >
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
    <footer style={{background:'#003366',color:'#fff',fontSize:'12px',padding:'10px 18px',display:'flex',gap:'16px',flexWrap:'wrap' as const}}>
      <span>© EMBL-EBI 2026</span>
      <a href="https://www.ebi.ac.uk" style={{color:'#cce',textDecoration:'none'}} target="_blank" rel="noopener">EMBL-EBI</a>
      <a href="https://www.ebi.ac.uk/ena" style={{color:'#cce',textDecoration:'none'}} target="_blank" rel="noopener">ENA</a>
      <a href="https://www.ebi.ac.uk/metagenomics" style={{color:'#cce',textDecoration:'none'}} target="_blank" rel="noopener">MGnify</a>
      <a href="https://www.ebi.ac.uk/about/terms-of-use" style={{color:'#cce',textDecoration:'none'}} target="_blank" rel="noopener">Terms of use</a>
    </footer>
    </>
  );
}

function EditableTable({
  tableName,
  rows,
  onChange,
  enumNames = new Set(),
  onOpenEnum,
  focusLocation
}: {
  tableName: string;
  rows: Row[];
  onChange: (rows: Row[], location?: EditLocation) => void;
  enumNames?: Set<string>;
  onOpenEnum?: (enumName: string) => void;
  focusLocation?: EditLocation | null;
}) {
  const [search, setSearch] = useState('');
  const columns = useMemo(() => {
    const names = new Set<string>();
    rows.forEach((row) => Object.keys(row).forEach((key) => names.add(key)));
    return [...names];
  }, [rows]);
  const visibleRows = useMemo(
    () =>
      rows
        .map((row, sourceIndex) => ({ row, sourceIndex }))
        .filter(({ row }) => tableRowMatches(row, columns, search)),
    [columns, rows, search]
  );
  const visibleGridRows = useMemo(() => visibleRows.map(({ row }) => row), [visibleRows]);
  const visibleFocusLocation = useMemo(() => {
    if (!focusLocation || focusLocation.tableName !== tableName || focusLocation.rowIndex === undefined) {
      return focusLocation;
    }
    const visibleIndex = visibleRows.findIndex(({ sourceIndex }) => sourceIndex === focusLocation.rowIndex);
    if (visibleIndex < 0) return null;
    return { ...focusLocation, rowIndex: visibleIndex };
  }, [focusLocation, tableName, visibleRows]);

  function addRow() {
    onChange([...rows, Object.fromEntries(columns.map((column) => [column, '']))]);
    setSearch('');
  }
  const updateVisibleRows = useCallback((nextVisibleRows: Row[], location?: EditLocation) => {
    const nextRows = reconcileTableRows(rows, visibleRows, nextVisibleRows, search);
    const visibleRowIndex = location?.rowIndex;
    const rowIndex =
      visibleRowIndex === undefined
        ? undefined
        : visibleRows[visibleRowIndex]?.sourceIndex ?? Math.min(visibleRowIndex, nextRows.length - 1);
    onChange(nextRows, location ? { ...location, tableName, rowIndex } : { tableName });
  }, [onChange, rows, search, tableName, visibleRows]);
  const rangeRenderer = useMemo(
    () => (onOpenEnum ? enumRangeRenderer(enumNames, onOpenEnum) : undefined),
    [enumNames, onOpenEnum]
  );
  const cellMeta = useCallback(
    (_rowIndex: number, column: string) =>
      column === 'range' && rangeRenderer
        ? { renderer: rangeRenderer }
        : undefined,
    [rangeRenderer]
  );

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
      <div className="table-toolbar">
        <label className="search-box">
          <Search size={15} />
          <input value={search} onChange={(event) => setSearch(event.target.value)} />
        </label>
        <span>{visibleRows.length} / {rows.length}</span>
        <button className="compact" onClick={addRow}>
          Add row
        </button>
      </div>
      <DataGrid
        key={`${tableName}:${columns.join('\u001f')}`}
        tableName={tableName}
        rows={visibleGridRows}
        onChange={updateVisibleRows}
        columns={columns}
        pinnedColumns={tableName === 'slots' ? SLOT_PINNED_COLUMNS : undefined}
        cellMeta={cellMeta}
        focusLocation={visibleFocusLocation}
      />
    </div>
  );
}

function EnumWorkspace({
  tables,
  selectedEnum,
  onSelectEnum,
  onChange,
  focusLocation
}: {
  tables: Tables;
  selectedEnum: string;
  onSelectEnum: (enumName: string) => void;
  onChange: (tables: Tables, sourceTable?: string, location?: EditLocation) => void;
  focusLocation?: EditLocation | null;
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
  const enumValueRows = useMemo(
    () =>
      valueRows
        .map((row, sourceIndex) => ({ row, sourceIndex }))
        .filter(({ row }) => cellText(row.enum) === effectiveEnum),
    [effectiveEnum, valueRows]
  );
  const visibleValueRows = useMemo(
    () => enumValueRows.filter(({ row }) => enumRowMatches(row, search)),
    [enumValueRows, search]
  );
  const visibleValueGridRows = useMemo(() => visibleValueRows.map(({ row }) => row), [visibleValueRows]);
  const selectedVisibleRowIndex = useMemo(
    () => visibleValueRows.findIndex(({ row }) => cellText(row.permissible_value) === selectedValue),
    [selectedValue, visibleValueRows]
  );
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

  const patchTables = useCallback((nextTables: Tables, sourceTable?: string, location?: EditLocation) => {
    onChange(nextTables, sourceTable, location);
  }, [onChange]);

  function updateEnumField(column: string, value: string) {
    patchTables({
      ...tables,
      enums: enumRows.map((row) =>
        cellText(row.enum) === effectiveEnum ? { ...row, [column]: value } : row
      )
    }, 'enums', { tableName: ENUM_WORKSPACE, column, enumName: effectiveEnum });
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
    }, 'enums', { tableName: ENUM_WORKSPACE, column: 'enum', enumName: cleanName });
    onSelectEnum(cleanName);
  }

  function addEnum() {
    const enumName = uniqueEnumName(enumRows, 'NewEnumMenu');
    patchTables({
      ...tables,
      enums: [...enumRows, { enum: enumName, description: '', annotations: '' }]
    }, 'enums', { tableName: ENUM_WORKSPACE, column: 'enum', enumName });
    onSelectEnum(enumName);
    setSearch('');
    setSelectedValue('');
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
    }, 'permissible_values', {
      tableName: ENUM_WORKSPACE,
      rowIndex: visibleValueRows.length,
      column: 'permissible_value',
      enumName: effectiveEnum
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
    }, 'permissible_values', {
      tableName: ENUM_WORKSPACE,
      rowIndex: visibleValueRows.length,
      column: 'permissible_value',
      enumName: effectiveEnum
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
    }, 'permissible_values', {
      tableName: ENUM_WORKSPACE,
      rowIndex: Math.max(0, selectedVisibleRowIndex),
      column: 'permissible_value',
      enumName: effectiveEnum
    });
  }

  const updateValues = useCallback((nextVisibleRows: Row[], location?: EditLocation) => {
    const nextEnumRows = reconcileEnumValueRows(enumValueRows, visibleValueRows, nextVisibleRows, effectiveEnum, search);
    patchTables({
      ...tables,
      permissible_values: replaceEnumValueRows(valueRows, effectiveEnum, nextEnumRows)
    }, 'permissible_values', { ...location, tableName: ENUM_WORKSPACE, enumName: effectiveEnum });
    const selectedIndex = visibleValueRows.findIndex(({ row }) => cellText(row.permissible_value) === selectedValue);
    if (selectedIndex !== -1) {
      const nextSelectedValue = cellText(nextVisibleRows[selectedIndex]?.permissible_value);
      setSelectedValue((current) => (current === nextSelectedValue ? current : nextSelectedValue));
    }
  }, [effectiveEnum, enumValueRows, patchTables, search, selectedValue, tables, valueRows, visibleValueRows]);
  const selectVisibleValueRow = useCallback(
    (rowIndex: number | null) => {
      const nextSelectedValue = rowIndex === null ? '' : cellText(visibleValueRows[rowIndex]?.row.permissible_value);
      setSelectedValue((current) => (current === nextSelectedValue ? current : nextSelectedValue));
    },
    [visibleValueRows]
  );

  if (!enumRows.length) {
    return (
      <div className="empty-state">
        <button className="command" onClick={addEnum}>
          <Plus size={15} /> Add enum
        </button>
      </div>
    );
  }

  return (
    <div className="enum-workspace">
      <aside className="enum-browser" aria-label="Enums">
        <div className="enum-browser-header">
          <button className="compact" onClick={addEnum}><Plus size={15} /> Add enum</button>
        </div>
        <div className="enum-browser-list">
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
        </div>
      </aside>
      <section className="enum-editor">
        <div className="enum-meta">
          <label>
            Name
            <CommitInput value={effectiveEnum} onCommit={renameEnum} />
          </label>
          <label>
            Description
            <CommitInput
              value={cellText(enumRow?.description)}
              onCommit={(value) => updateEnumField('description', value)}
            />
          </label>
          <label>
            Annotations
            <CommitInput
              value={cellText(enumRow?.annotations)}
              onCommit={(value) => updateEnumField('annotations', value)}
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
          <DataGrid
            key={`${effectiveEnum}:${ENUM_VALUE_COLUMNS.join('\u001f')}`}
            tableName={ENUM_WORKSPACE}
            columns={ENUM_VALUE_COLUMNS}
            rows={visibleValueGridRows}
            onChange={updateValues}
            onRowSelect={selectVisibleValueRow}
            selectedRowIndex={selectedVisibleRowIndex}
            focusLocation={focusLocation?.tableName === ENUM_WORKSPACE ? focusLocation : null}
          />
        </div>
      </section>
    </div>
  );
}

function enumRangeRenderer(enumNames: Set<string>, onOpenEnum: (enumName: string) => void) {
  return (
    instance: Parameters<typeof textRenderer>[0],
    td: HTMLTableCellElement,
    row: number,
    column: number,
    prop: string | number,
    value: unknown,
    cellProperties: Parameters<typeof textRenderer>[6]
  ) => {
    const enumName = cellText(value);
    if (!enumNames.has(enumName)) {
      textRenderer(instance, td, row, column, prop, value, cellProperties);
      return;
    }
    td.replaceChildren();
    td.classList.add('range-hot-cell');
    const label = document.createElement('span');
    label.className = 'range-hot-value';
    label.textContent = enumName;
    const button = document.createElement('button');
    button.type = 'button';
    button.className = 'enum-cell-link';
    button.textContent = enumName;
    button.addEventListener('mousedown', (event) => event.preventDefault());
    button.addEventListener('click', (event) => {
      event.stopPropagation();
      onOpenEnum(enumName);
    });
    td.append(label, button);
  };
}

function CommitInput({ value, onCommit }: { value: string; onCommit: (value: string) => void }) {
  const [draft, setDraft] = useState(value);

  useEffect(() => {
    setDraft(value);
  }, [value]);

  function commit() {
    if (draft !== value) {
      onCommit(draft);
    }
  }

  return (
    <input
      value={draft}
      onChange={(event) => setDraft(event.target.value)}
      onBlur={commit}
      onKeyDown={(event) => {
        if (event.key === 'Enter') {
          commit();
          event.currentTarget.blur();
        } else if (event.key === 'Escape') {
          setDraft(value);
          event.currentTarget.blur();
        }
      }}
    />
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
        destroyPreviewHotInstances(contextRef.current);
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
      destroyPreviewHotInstances(contextRef.current);
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
  dhs?: Record<string, { hot?: { destroy: () => void } | null }>;
  getLocaleData: (template?: unknown) => unknown;
};

function destroyPreviewHotInstances(context: PreviewAppContext | null) {
  if (!context?.dhs) return;
  for (const dh of Object.values(context.dhs)) {
    if (!dh?.hot) continue;
    dh.hot.destroy();
    dh.hot = null;
  }
}

function cellText(value: unknown): string {
  return value === null || value === undefined ? '' : String(value);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function canScrollHorizontally(target: EventTarget | null, deltaX: number): boolean {
  let element = target instanceof Element ? target : null;
  while (element && element !== document.body) {
    const style = window.getComputedStyle(element);
    const allowsHorizontalScroll = ['auto', 'scroll', 'overlay'].includes(style.overflowX);
    if (allowsHorizontalScroll && element.scrollWidth > element.clientWidth) {
      const maxScrollLeft = element.scrollWidth - element.clientWidth;
      if (deltaX < 0 && element.scrollLeft > 0) return true;
      if (deltaX > 0 && element.scrollLeft < maxScrollLeft) return true;
    }
    element = element.parentElement;
  }
  return false;
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

function tableRowMatches(row: Row, columns: string[], search: string): boolean {
  const query = search.trim().toLowerCase();
  if (!query) return true;
  return columns.some((column) => cellText(row[column]).toLowerCase().includes(query));
}

function reconcileTableRows(
  sourceRows: Row[],
  visibleRows: { row: Row; sourceIndex: number }[],
  nextVisibleRows: Row[],
  search: string
): Row[] {
  if (!search.trim()) {
    return nextVisibleRows;
  }

  const visibleSourceIndexes = new Set(visibleRows.map(({ sourceIndex }) => sourceIndex));
  const nextRows: Row[] = [];
  let nextVisibleIndex = 0;
  let insertedReplacement = false;

  sourceRows.forEach((row, sourceIndex) => {
    if (!visibleSourceIndexes.has(sourceIndex)) {
      nextRows.push(row);
      return;
    }
    if (nextVisibleIndex < nextVisibleRows.length) {
      nextRows.push(nextVisibleRows[nextVisibleIndex]);
      nextVisibleIndex += 1;
    }
    insertedReplacement = true;
  });

  const remainingRows = nextVisibleRows.slice(nextVisibleIndex);
  if (!remainingRows.length) return nextRows;
  if (!insertedReplacement) return [...sourceRows, ...remainingRows];
  return [...nextRows, ...remainingRows];
}

function reconcileEnumValueRows(
  enumRows: { row: Row; sourceIndex: number }[],
  visibleRows: { row: Row; sourceIndex: number }[],
  nextVisibleRows: Row[],
  enumName: string,
  search: string
): Row[] {
  const normalizedNextRows = nextVisibleRows.map((row) => normalizeEnumValueRow(row, enumName));
  if (!search.trim()) {
    return normalizedNextRows;
  }

  const visibleSourceIndexes = new Set(visibleRows.map(({ sourceIndex }) => sourceIndex));
  const mergedRows: Row[] = [];
  let nextIndex = 0;
  let inserted = false;
  for (const { row, sourceIndex } of enumRows) {
    if (!visibleSourceIndexes.has(sourceIndex)) {
      mergedRows.push(row);
      continue;
    }
    if (nextIndex < normalizedNextRows.length) {
      mergedRows.push(normalizedNextRows[nextIndex]);
      nextIndex += 1;
    }
    inserted = true;
  }
  const remainingRows = normalizedNextRows.slice(nextIndex);
  if (remainingRows.length) {
    if (inserted) {
      mergedRows.push(...remainingRows);
    } else {
      return [...enumRows.map(({ row }) => row), ...remainingRows];
    }
  }
  return mergedRows;
}

function replaceEnumValueRows(valueRows: Row[], enumName: string, nextEnumRows: Row[]): Row[] {
  if (!enumName) return valueRows;
  const nextRows: Row[] = [];
  let insertedReplacement = false;
  for (const row of valueRows) {
    if (cellText(row.enum) !== enumName) {
      nextRows.push(row);
      continue;
    }
    if (!insertedReplacement) {
      nextRows.push(...nextEnumRows);
      insertedReplacement = true;
    }
  }
  if (!insertedReplacement) {
    nextRows.push(...nextEnumRows);
  }
  return nextRows;
}

function normalizeEnumValueRow(row: Row, enumName: string): Row {
  return {
    enum: enumName,
    permissible_value: row.permissible_value ?? '',
    text: row.text ?? '',
    description: row.description ?? '',
    meaning: row.meaning ?? '',
    comments: row.comments ?? ''
  };
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

function uniqueEnumName(rows: Row[], base: string): string {
  const existing = new Set(rows.map((row) => cellText(row.enum)));
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

function isUndoRedoShortcut(event: KeyboardEvent) {
  if (!(event.ctrlKey || event.metaKey) || event.altKey) return false;
  const key = event.key.toLowerCase();
  return key === 'z' || key === 'y';
}

function isRedoShortcut(event: KeyboardEvent) {
  const key = event.key.toLowerCase();
  return key === 'y' || (key === 'z' && event.shiftKey);
}

function isTextEditingTarget(target: Element) {
  if (target instanceof HTMLTextAreaElement && target.classList.contains('handsontableInput')) {
    return false;
  }
  if (target instanceof HTMLInputElement || target instanceof HTMLTextAreaElement) return true;
  if (target instanceof HTMLElement && target.isContentEditable) return true;
  return false;
}

function cloneTables(tables: Tables): Tables {
  return Object.fromEntries(
    Object.entries(tables).map(([name, rows]) => [name, rows.map((row) => ({ ...row }))])
  );
}

function tablesEqual(left: Tables, right: Tables) {
  return JSON.stringify(left) === JSON.stringify(right);
}
