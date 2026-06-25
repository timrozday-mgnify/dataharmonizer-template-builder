import { HotTable, type HotTableRef } from '@handsontable/react-wrapper';
import Handsontable from 'handsontable';
import { registerAllModules } from 'handsontable/registry';
import 'handsontable/styles/handsontable.css';
import 'handsontable/styles/ht-theme-main.css';
import { useMemo, useRef } from 'react';

import type { Row } from './types';

registerAllModules();

export const HANDSONTABLE_LICENSE_KEY = 'non-commercial-and-evaluation';

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

export type { HotTableRef };

export function DataGrid({
  rows,
  onChange,
  columns,
  pinnedColumns = [],
  enableRowOps = true,
  onRowSelect,
  selectedRowIndex,
  cellMeta
}: DataGridProps) {
  const hotRef = useRef<HotTableRef>(null);
  const manuallyResizedColumns = useRef(new Set<number>());
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

  function emitChange() {
    const sourceData = hotRef.current?.hotInstance?.getSourceData() ?? [];
    onChange(copyRows(sourceData as Row[]));
  }

  return (
    <div className="hot-grid-wrap">
      <HotTable
        ref={hotRef}
        data={rows}
        dataSchema={dataSchema}
        columns={hotColumns}
        colHeaders={true}
        rowHeaders={true}
        height="100%"
        width="100%"
        stretchH="none"
        themeName="ht-theme-main"
        licenseKey={HANDSONTABLE_LICENSE_KEY}
        selectionMode="multiple"
        manualColumnResize={true}
        fillHandle={true}
        multiColumnSorting={true}
        fixedColumnsStart={pinnedColumns.filter((column) => orderedColumns.includes(column)).length}
        contextMenu={enableRowOps ? ['row_above', 'row_below', 'remove_row', '---------', 'undo', 'redo'] : false}
        manualRowMove={enableRowOps}
        modifyColWidth={(width, column) =>
          manuallyResizedColumns.current.has(column) ? width : Math.min(width, 200)
        }
        afterColumnResize={(_newSize, column) => {
          manuallyResizedColumns.current.add(column);
        }}
        afterChange={(_changes, source) => {
          if (source !== 'loadData') {
            emitChange();
          }
        }}
        afterCreateRow={emitChange}
        afterRemoveRow={emitChange}
        afterRowMove={emitChange}
        afterSelectionEnd={(row) => {
          onRowSelect?.(row >= 0 ? row : null);
        }}
        cells={(row, column) => {
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
        }}
      />
    </div>
  );
}

function copyRows(rows: Row[]): Row[] {
  return rows.map((row) => ({ ...row }));
}
