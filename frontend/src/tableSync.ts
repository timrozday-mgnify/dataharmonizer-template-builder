import type { Row, Tables } from './types';

const SLOT_ANNOTATION_COLUMNS: Record<string, string> = {
  annotation_id: 'id',
  annotation_source: 'source',
  annotation_mimicc_default_unit: 'mimicc_default_unit'
};

type SyncOptions = {
  sourceTable?: string;
};

export function syncTables(previousTables: Tables, nextTables: Tables, options: SyncOptions = {}): Tables {
  const tables = cloneTables(nextTables);
  for (const name of ['classes', 'slots', 'enums', 'permissible_values', 'annotations']) {
    tables[name] ??= [];
  }

  syncRenames(previousTables, tables, options.sourceTable);
  syncClassSlotMembership(tables, options.sourceTable);
  syncSlotAnnotations(tables, options.sourceTable);
  syncEnumAnnotations(tables, options.sourceTable);
  return tables;
}

function syncRenames(previousTables: Tables, tables: Tables, sourceTable?: string) {
  if (sourceTable === 'classes') {
    forEachRowRename(previousTables.classes, tables.classes, 'class', (oldName, nextName) => {
      replaceCellValue(tables.slots, 'class', oldName, nextName);
      replaceAnnotationTarget(tables.annotations, 'class', oldName, nextName);
    });
  }

  if (sourceTable === 'slots') {
    forEachRowRename(previousTables.slots, tables.slots, 'slot', (oldName, nextName) => {
      replaceAnnotationTarget(tables.annotations, 'slot', oldName, nextName);
    });
  }

  if (sourceTable === 'enums') {
    forEachRowRename(previousTables.enums, tables.enums, 'enum', (oldName, nextName) => {
      replaceCellValue(tables.permissible_values, 'enum', oldName, nextName);
      replaceCellValue(tables.slots, 'range', oldName, nextName);
      replaceAnnotationTarget(tables.annotations, 'enum', oldName, nextName);
    });
  }
}

function syncClassSlotMembership(tables: Tables, sourceTable?: string) {
  if (sourceTable === 'classes') {
    for (const classRow of tables.classes ?? []) {
      const className = cellText(classRow.class);
      const slotNames = splitList(classRow.slots);
      if (!className) continue;
      tables.slots = rebuildClassSlotRows(tables.slots ?? [], className, slotNames);
    }
    return;
  }

  const slotsByClass = new Map<string, string[]>();
  for (const row of tables.slots ?? []) {
    const className = cellText(row.class);
    const slotName = cellText(row.slot);
    if (className && slotName) {
      slotsByClass.set(className, [...(slotsByClass.get(className) ?? []), slotName]);
    }
  }
  tables.classes = (tables.classes ?? []).map((row) => {
    const className = cellText(row.class);
    return slotsByClass.has(className) ? { ...row, slots: slotsByClass.get(className)?.join('; ') ?? '' } : row;
  });
}

function syncSlotAnnotations(tables: Tables, sourceTable?: string) {
  if (sourceTable !== 'annotations') {
    for (const row of tables.slots ?? []) {
      const slotName = cellText(row.slot);
      if (!slotName) continue;
      for (const [rowKey, annotationKey] of Object.entries(SLOT_ANNOTATION_COLUMNS)) {
        upsertAnnotation(tables, 'slot', slotName, annotationKey, row[rowKey]);
      }
    }
  }

  const slotRows = new Map((tables.slots ?? []).map((row) => [cellText(row.slot), row]));
  for (const row of tables.annotations ?? []) {
    if (cellText(row.element_type) !== 'slot') continue;
    const slotRow = slotRows.get(cellText(row.element));
    const rowKey = rowKeyForAnnotation(cellText(row.key));
    if (slotRow && rowKey) {
      slotRow[rowKey] = row.value ?? '';
    }
  }
}

function syncEnumAnnotations(tables: Tables, sourceTable?: string) {
  if (sourceTable !== 'annotations') {
    for (const row of tables.enums ?? []) {
      const enumName = cellText(row.enum);
      if (!enumName) continue;
      for (const [key, value] of Object.entries(parseMapping(row.annotations))) {
        upsertAnnotation(tables, 'enum', enumName, key, value);
      }
    }
  }

  const enumRows = new Map((tables.enums ?? []).map((row) => [cellText(row.enum), row]));
  for (const row of tables.annotations ?? []) {
    if (cellText(row.element_type) !== 'enum') continue;
    const enumRow = enumRows.get(cellText(row.element));
    const key = cellText(row.key);
    if (!enumRow || !key) continue;
    const annotations = parseMapping(enumRow.annotations);
    annotations[key] = row.value ?? '';
    enumRow.annotations = Object.keys(annotations).length ? JSON.stringify(annotations) : '';
  }
}

function rebuildClassSlotRows(slotRows: Row[], className: string, slotNames: string[]) {
  const unrelatedRows = slotRows.filter((row) => cellText(row.class) !== className);
  const currentClassRows = slotRows.filter((row) => cellText(row.class) === className);
  const allRowsBySlot = new Map(slotRows.map((row) => [cellText(row.slot), row]));
  const classRowsBySlot = new Map(currentClassRows.map((row) => [cellText(row.slot), row]));
  const orderedRows = slotNames.map((slotName, index) => ({
    ...(allRowsBySlot.get(slotName) ?? {}),
    ...(classRowsBySlot.get(slotName) ?? {}),
    class: className,
    slot: slotName,
    rank: cellText(classRowsBySlot.get(slotName)?.rank) || String(index + 1)
  }));
  return [...unrelatedRows, ...orderedRows];
}

function forEachRowRename(
  previousRows: Row[] | undefined,
  nextRows: Row[] | undefined,
  column: string,
  onRename: (oldName: string, nextName: string) => void
) {
  const previous = previousRows ?? [];
  const next = nextRows ?? [];
  for (let index = 0; index < Math.min(previous.length, next.length); index += 1) {
    const oldName = cellText(previous[index]?.[column]);
    const nextName = cellText(next[index]?.[column]);
    if (oldName && nextName && oldName !== nextName) {
      onRename(oldName, nextName);
    }
  }
}

function replaceCellValue(rows: Row[] | undefined, column: string, oldValue: string, nextValue: string) {
  for (const row of rows ?? []) {
    if (cellText(row[column]) === oldValue) {
      row[column] = nextValue;
    }
  }
}

function replaceAnnotationTarget(
  rows: Row[] | undefined,
  elementType: string,
  oldElement: string,
  nextElement: string
) {
  for (const row of rows ?? []) {
    if (cellText(row.element_type) === elementType && cellText(row.element) === oldElement) {
      row.element = nextElement;
    }
  }
}

function upsertAnnotation(
  tables: Tables,
  elementType: string,
  element: string,
  key: string,
  value: Row[string]
) {
  const annotations = tables.annotations ?? [];
  const match = annotations.find(
    (row) =>
      cellText(row.element_type) === elementType &&
      cellText(row.element) === element &&
      cellText(row.key) === key
  );
  if (value === null || value === undefined || value === '') {
    if (match) {
      tables.annotations = annotations.filter((row) => row !== match);
    }
    return;
  }
  if (match) {
    match.value = value;
  } else {
    annotations.push({ element_type: elementType, element, key, value });
    tables.annotations = annotations;
  }
}

function rowKeyForAnnotation(annotationKey: string) {
  return Object.entries(SLOT_ANNOTATION_COLUMNS).find(([, key]) => key === annotationKey)?.[0] ?? '';
}

function parseMapping(value: unknown): Record<string, Row[string]> {
  if (!value) return {};
  if (typeof value === 'object' && !Array.isArray(value)) {
    return value as Record<string, Row[string]>;
  }
  try {
    const parsed = JSON.parse(String(value));
    return parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? parsed : {};
  } catch {
    return parseSimpleMapping(String(value));
  }
}

function parseSimpleMapping(value: string): Record<string, Row[string]> {
  const parsed: Record<string, Row[string]> = {};
  for (const line of value.split('\n')) {
    const separatorIndex = line.indexOf(':');
    if (separatorIndex <= 0) return {};
    const key = line.slice(0, separatorIndex).trim();
    const rawValue = line.slice(separatorIndex + 1).trim();
    if (!key) return {};
    parsed[key] = rawValue.replace(/^['"]|['"]$/g, '');
  }
  return parsed;
}

function splitList(value: unknown) {
  return cellText(value)
    .split(';')
    .map((part) => part.trim())
    .filter(Boolean);
}

function cloneTables(tables: Tables): Tables {
  return Object.fromEntries(
    Object.entries(tables).map(([name, rows]) => [name, rows.map((row) => ({ ...row }))])
  );
}

function cellText(value: unknown): string {
  return value === null || value === undefined ? '' : String(value).trim();
}
