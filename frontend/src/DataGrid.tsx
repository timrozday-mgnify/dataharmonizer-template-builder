import Handsontable from 'handsontable';
import { registerAllModules } from 'handsontable/registry';
import 'handsontable/styles/handsontable.css';
import 'handsontable/styles/ht-theme-main.css';
import { useCallback, useEffect, useMemo, useRef } from 'react';

import type { Row } from './types';

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
  'remove_row',
  '---------',
  'undo',
  'redo'
];
const COLUMN_TITLES: Record<string, string> = {
  annotation_default_unit: 'Default Unit'
};

type CellMetaFactory = (rowIndex: number, columnKey: string) => Partial<Handsontable.CellMeta> | undefined;

type DataGridProps = {
  rows: Row[];
  onChange: (rows: Row[]) => void;
  columns?: string[];
  pinnedColumns?: string[];
  enableRowOps?: boolean;
  onRowSelect?: (rowIndex: number | null) => void;
  selectedRowIndex?: number | null;
  cellMeta?: CellMetaFactory;
};

export type HotTableRef = { hotInstance: Handsontable.Core | null };

export function DataGrid({
  rows,
  onChange,
  columns,
  pinnedColumns = EMPTY_COLUMNS,
  enableRowOps = true,
  onRowSelect,
  selectedRowIndex,
  cellMeta
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
        title: COLUMN_TITLES[column] ?? column.replaceAll('_', ' ')
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

  const emitChange = useCallback(() => {
    const sourceData = hotRef.current?.getSourceData() ?? [];
    onChange(copyRows(sourceData as Row[]));
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
        emitChange();
      }
    },
    [emitChange]
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
      data: copyRows(rows),
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
      fixedColumnsStart,
      viewportColumnRenderingOffset: 8,
      contextMenu,
      allowInsertRow: enableRowOps,
      allowRemoveRow: enableRowOps,
      manualRowMove: enableRowOps,
      modifyColWidth,
      afterColumnResize,
      afterChange,
      afterCreateRow: emitChange,
      afterRemoveRow: emitChange,
      afterRowMove: emitChange,
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
      rows
    ]
  );

  useEffect(() => {
    if (!containerRef.current) return undefined;
    applyingSettings.current = true;
    const hot = new Handsontable.Core(containerRef.current, gridSettings);
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

  return (
    <div className="hot-grid-wrap">
      <div ref={containerRef} style={HOT_TABLE_STYLE} />
    </div>
  );
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
