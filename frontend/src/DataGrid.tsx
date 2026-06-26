import Handsontable from 'handsontable';
import { registerAllModules } from 'handsontable/registry';
import 'handsontable/styles/handsontable.css';
import 'handsontable/styles/ht-theme-main.css';
import { useCallback, useEffect, useMemo, useRef } from 'react';

import type { EditLocation, Row } from './types';

registerAllModules();

export const HANDSONTABLE_LICENSE_KEY = 'non-commercial-and-evaluation';
const EMPTY_COLUMNS: string[] = [];
const HOT_TABLE_STYLE = { height: '100%', width: '100%' };
const DEFAULT_ROW_HEIGHT = 30;
const COLUMN_SAMPLE_LIMIT = 50;
const COLUMN_CHAR_WIDTH = 8;
const COLUMN_PADDING = 32;
const DEFAULT_MIN_COLUMN_WIDTH = 90;
const DEFAULT_MAX_COLUMN_WIDTH = 360;
const VERBOSE_MAX_COLUMN_WIDTH = 420;
const COMPACT_MAX_COLUMN_WIDTH = 220;
const ROW_CONTEXT_MENU: Handsontable.plugins.ContextMenu.PredefinedMenuItemKey[] = [
  'row_above',
  'row_below',
  'remove_row'
];
type CellMetaFactory = (rowIndex: number, columnKey: string) => Partial<Handsontable.CellMeta> | undefined;

type DataGridProps = {
  tableName: string;
  rows: Row[];
  onChange: (rows: Row[], location?: EditLocation) => void;
  columns?: string[];
  pinnedColumns?: string[];
  enableRowOps?: boolean;
  onRowSelect?: (rowIndex: number | null) => void;
  selectedRowIndex?: number | null;
  cellMeta?: CellMetaFactory;
  focusLocation?: EditLocation | null;
};

export type HotTableRef = { hotInstance: Handsontable.Core | null };

export function DataGrid({
  tableName,
  rows,
  onChange,
  columns,
  pinnedColumns = EMPTY_COLUMNS,
  enableRowOps = true,
  onRowSelect,
  selectedRowIndex,
  cellMeta,
  focusLocation
}: DataGridProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const hotRef = useRef<Handsontable.Core | null>(null);
  const applyingSettings = useRef(false);
  const manuallyResizedColumns = useRef(new Map<number, number>());
  const derivedColumnSignature = useMemo(() => {
    if (columns) return columns.join('\u001f');
    const names = new Set<string>();
    rows.forEach((row) => Object.keys(row).forEach((key) => names.add(key)));
    return [...names].sort().join('\u001f');
  }, [columns, rows]);
  const orderedColumns = useMemo(() => {
    const baseColumns = columns ?? derivedColumnSignature.split('\u001f').filter(Boolean);
    const pinned = pinnedColumns.filter((column) => baseColumns.includes(column));
    const remaining = baseColumns.filter((column) => !pinned.includes(column));
    return [...pinned, ...remaining];
  }, [columns, derivedColumnSignature, pinnedColumns]);
  const hotColumns = useMemo<Handsontable.ColumnSettings[]>(
    () =>
      orderedColumns.map((column) => ({
        data: column,
        title: column.replaceAll('_', ' ')
      })),
    [orderedColumns]
  );
  const dataSchema = useMemo<Row>(
    () => Object.fromEntries(orderedColumns.map((column) => [column, ''])),
    [orderedColumns]
  );
  const measuredColumnWidths = useMemo(
    () => measureColumnWidths(orderedColumns, rows, manuallyResizedColumns.current),
    [orderedColumns, rows]
  );

  const emitChange = useCallback((location?: EditLocation) => {
    const sourceData = hotRef.current?.getSourceData() ?? [];
    onChange(copyRows(sourceData as Row[]), location);
  }, [onChange]);
  const fixedColumnsStart = useMemo(
    () => pinnedColumns.filter((column) => orderedColumns.includes(column)).length,
    [orderedColumns, pinnedColumns]
  );
  const contextMenu = useMemo(() => (enableRowOps ? ROW_CONTEXT_MENU : false), [enableRowOps]);
  const modifyColWidth = useCallback((width: number, column: number) => {
    return manuallyResizedColumns.current.get(column) ?? Math.min(width, VERBOSE_MAX_COLUMN_WIDTH);
  }, []);
  const afterColumnResize = useCallback((newSize: number, column: number) => {
    if (newSize > 0) {
      manuallyResizedColumns.current.set(column, newSize);
    }
  }, []);
  const afterChange = useCallback(
    (_changes: Handsontable.CellChange[] | null, source: Handsontable.ChangeSource) => {
      if (!applyingSettings.current && source !== 'loadData') {
        emitChange(locationFromChange(tableName, _changes, orderedColumns));
      }
    },
    [emitChange, orderedColumns, tableName]
  );
  const afterSelectionEnd = useCallback(
    (row: number) => {
      onRowSelect?.(row >= 0 ? row : null);
    },
    [onRowSelect]
  );
  const cells = useCallback(
    (row: number, column: number) => {
      const columnKey = orderedColumns[column];
      const meta: Partial<Handsontable.CellMeta> = {};
      if (row === selectedRowIndex) {
        meta.className = 'selected-row';
      }
      if (columnKey && cellMeta) {
        const customMeta = cellMeta(row, columnKey);
        Object.assign(meta, customMeta);
        if (meta.className && customMeta?.className) {
          meta.className = `${row === selectedRowIndex ? 'selected-row ' : ''}${customMeta.className}`;
        }
      }
      return meta;
    },
    [cellMeta, orderedColumns, selectedRowIndex]
  );
  const gridSettings = useMemo<Handsontable.GridSettings>(
    () => ({
      dataSchema,
      columns: hotColumns,
      colHeaders: true,
      rowHeaders: true,
      height: '100%',
      width: '100%',
      stretchH: 'none',
      themeName: 'ht-theme-main',
      licenseKey: HANDSONTABLE_LICENSE_KEY,
      selectionMode: 'multiple',
      outsideClickDeselects: false,
      manualColumnResize: true,
      autoColumnSize: false,
      colWidths: measuredColumnWidths,
      autoRowSize: false,
      rowHeights: DEFAULT_ROW_HEIGHT,
      wordWrap: false,
      fillHandle: true,
      multiColumnSorting: true,
      undo: false,
      fixedColumnsStart,
      viewportColumnRenderingOffset: 8,
      contextMenu,
      allowInsertRow: enableRowOps,
      allowRemoveRow: enableRowOps,
      manualRowMove: enableRowOps,
      modifyColWidth,
      afterColumnResize,
      afterChange,
      afterCreateRow: (index) => emitChange({ tableName, rowIndex: index }),
      afterRemoveRow: (index) => emitChange({ tableName, rowIndex: index }),
      afterRowMove: (movedRows, finalIndex) => {
        const rowIndex = typeof finalIndex === 'number' ? finalIndex : movedRows[0];
        emitChange({ tableName, rowIndex });
      },
      afterSelectionEnd,
      cells
    }),
    [
      afterChange,
      afterColumnResize,
      afterSelectionEnd,
      cells,
      contextMenu,
      dataSchema,
      emitChange,
      enableRowOps,
      fixedColumnsStart,
      hotColumns,
      measuredColumnWidths,
      modifyColWidth,
      rows,
      tableName
    ]
  );

  useEffect(() => {
    if (!containerRef.current) return undefined;
    applyingSettings.current = true;
    const hot = new Handsontable.Core(containerRef.current, {
      ...gridSettings,
      data: copyRows(rows)
    });
    hot.init();
    applyingSettings.current = false;
    hotRef.current = hot;
    return () => {
      hotRef.current = null;
      hot.destroy();
    };
  }, []);

  useEffect(() => {
    if (!hotRef.current) return;
    applyingSettings.current = true;
    hotRef.current.updateSettings(gridSettings, false);
    applyingSettings.current = false;
  }, [gridSettings]);

  useEffect(() => {
    if (!hotRef.current) return;
    applyingSettings.current = true;
    hotRef.current.loadData(copyRows(rows));
    hotRef.current.render();
    refreshHotDimensions(hotRef.current);
    applyingSettings.current = false;
  }, [rows]);

  useEffect(() => {
    if (!hotRef.current || focusLocation?.tableName !== tableName) return;
    const rowIndex = focusLocation.rowIndex ?? 0;
    const columnIndex = focusLocation.column ? orderedColumns.indexOf(focusLocation.column) : 0;
    if (rowIndex < 0 || columnIndex < 0) return;
    hotRef.current.selectCell(rowIndex, columnIndex);
    hotRef.current.scrollViewportTo(rowIndex, columnIndex);
    hotRef.current.render();
  }, [focusLocation, orderedColumns, tableName, rows]);

  return (
    <div className="hot-grid-wrap">
      <div ref={containerRef} style={HOT_TABLE_STYLE} />
    </div>
  );
}

function locationFromChange(
  tableName: string,
  changes: Handsontable.CellChange[] | null,
  columns: string[]
): EditLocation | undefined {
  const firstChange = changes?.[0];
  if (!firstChange) return undefined;
  const [rowIndex, prop] = firstChange;
  const column = typeof prop === 'string' ? prop : typeof prop === 'number' ? columns[prop] : undefined;
  return { tableName, rowIndex, column };
}

function copyRows(rows: Row[]): Row[] {
  return rows.map((row) => ({ ...row }));
}

function measureColumnWidths(columns: string[], rows: Row[], manualWidths: Map<number, number>): number[] {
  return columns.map((column, index) => {
    const manualWidth = manualWidths.get(index);
    if (manualWidth) return manualWidth;

    const headerText = column.replaceAll('_', ' ');
    const maxSampleLength = rows
      .slice(0, COLUMN_SAMPLE_LIMIT)
      .reduce((length, row) => Math.max(length, cellText(row[column]).length), headerText.length);
    const maxWidth = columnMaxWidth(column);
    const measuredWidth = maxSampleLength * COLUMN_CHAR_WIDTH + COLUMN_PADDING;
    return Math.max(DEFAULT_MIN_COLUMN_WIDTH, Math.min(maxWidth, measuredWidth));
  });
}

function columnMaxWidth(column: string): number {
  if (['description', 'comments', 'annotations', 'meaning'].includes(column)) {
    return VERBOSE_MAX_COLUMN_WIDTH;
  }
  if (/(^|_)(id|name|rank|slot|enum|class)$/.test(column)) {
    return COMPACT_MAX_COLUMN_WIDTH;
  }
  return DEFAULT_MAX_COLUMN_WIDTH;
}

function cellText(value: unknown): string {
  return value === null || value === undefined ? '' : String(value);
}

function refreshHotDimensions(hot: Handsontable.Core) {
  (hot as Handsontable.Core & { refreshDimensions?: () => void }).refreshDimensions?.();
}
