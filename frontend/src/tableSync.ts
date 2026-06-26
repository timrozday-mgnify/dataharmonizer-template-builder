import type { Row, Tables } from './types';

const SLOT_ANNOTATION_COLUMN_PREFIX = 'Annotation: ';
const LEGACY_SLOT_ANNOTATION_COLUMN_PREFIX = 'annotation_';

const LEGACY_SLOT_ANNOTATION_COLUMNS: Record<string, string> = {
  mimicc_default_unit: 'default_unit'
};

const LEGACY_SLOT_ROW_COLUMNS: Record<string, string> = {
  annotation_mimicc_default_unit: 'Annotation: default_unit'
};

type SyncOptions = {
  sourceTable?: string;
};

export function syncTables(previousTables: Tables, nextTables: Tables, options: SyncOptions = {}): Tables {
  const tables = cloneTables(nextTables);
  for (const name of ['classes', 'slots', 'enums', 'permissible_values', 'annotations']) {
    tables[name] ??= [];
  }

  const renamed = syncRenames(previousTables, tables, options.sourceTable);
  syncDeletedReferences(previousTables, tables, renamed, options.sourceTable);
  pruneMissingReferences(tables);
  syncClassSlotMembership(tables, options.sourceTable);
  syncSlotAnnotations(tables, options.sourceTable);
  syncEnumAnnotations(tables, options.sourceTable);
  pruneMissingReferences(tables);
  return tables;
}

function syncRenames(previousTables: Tables, tables: Tables, sourceTable?: string) {
  const renamed = {
    classes: new Set<string>(),
    slots: new Set<string>(),
    enums: new Set<string>()
  };
  if (sourceTable === 'classes') {
    forEachRowRename(previousTables.classes, tables.classes, 'class', (oldName, nextName) => {
      renamed.classes.add(oldName);
      replaceCellValue(tables.slots, 'class', oldName, nextName);
      replaceAnnotationTarget(tables.annotations, 'class', oldName, nextName);
    });
  }

  if (sourceTable === 'slots') {
    forEachRowRename(previousTables.slots, tables.slots, 'slot', (oldName, nextName) => {
      renamed.slots.add(oldName);
      replaceAnnotationTarget(tables.annotations, 'slot', oldName, nextName);
    });
  }

  if (sourceTable === 'enums') {
    forEachRowRename(previousTables.enums, tables.enums, 'enum', (oldName, nextName) => {
      renamed.enums.add(oldName);
      replaceCellValue(tables.permissible_values, 'enum', oldName, nextName);
      replaceCellValue(tables.slots, 'range', oldName, nextName);
      replaceAnnotationTarget(tables.annotations, 'enum', oldName, nextName);
    });
  }
  return renamed;
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
  migrateLegacySlotRowColumns(tables);
  migrateLegacySlotAnnotations(tables);

  if (sourceTable !== 'annotations') {
    for (const row of tables.slots ?? []) {
      const slotName = cellText(row.slot);
      if (!slotName) continue;
      for (const rowKey of slotAnnotationColumns(row)) {
        const annotationKey = annotationKeyForColumn(rowKey);
        upsertAnnotation(tables, 'slot', slotName, annotationKey, row[rowKey]);
      }
    }
  } else {
    for (const row of tables.slots ?? []) {
      for (const rowKey of slotAnnotationColumns(row)) {
        row[rowKey] = '';
      }
    }
  }

  const slotRows = new Map((tables.slots ?? []).map((row) => [cellText(row.slot), row]));
  for (const row of tables.annotations ?? []) {
    if (cellText(row.element_type) !== 'slot') continue;
    const slotRow = slotRows.get(cellText(row.element));
    const rowKey = annotationColumnForKey(cellText(row.key));
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
      const annotations = parseMapping(row.annotations);
      removeEnumAnnotationRowsNotIn(tables, enumName, new Set(Object.keys(annotations)));
      for (const [key, value] of Object.entries(annotations)) {
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

function syncDeletedReferences(
  previousTables: Tables,
  tables: Tables,
  renamed: ReturnType<typeof syncRenames>,
  sourceTable?: string
) {
  if (sourceTable === 'classes') {
    const deletedClasses = deletedNames(previousTables.classes, tables.classes, 'class', renamed.classes);
    if (deletedClasses.size) {
      tables.slots = (tables.slots ?? []).filter((row) => !deletedClasses.has(cellText(row.class)));
      tables.annotations = (tables.annotations ?? []).filter(
        (row) => !(cellText(row.element_type) === 'class' && deletedClasses.has(cellText(row.element)))
      );
    }
  }

  if (sourceTable === 'slots') {
    const deletedSlots = deletedNames(previousTables.slots, tables.slots, 'slot', renamed.slots);
    if (deletedSlots.size) {
      tables.annotations = (tables.annotations ?? []).filter(
        (row) => !(cellText(row.element_type) === 'slot' && deletedSlots.has(cellText(row.element)))
      );
    }
  }

  if (sourceTable === 'enums') {
    const deletedEnums = deletedNames(previousTables.enums, tables.enums, 'enum', renamed.enums);
    if (deletedEnums.size) {
      tables.permissible_values = (tables.permissible_values ?? []).filter(
        (row) => !deletedEnums.has(cellText(row.enum))
      );
      tables.annotations = (tables.annotations ?? []).filter(
        (row) => !(cellText(row.element_type) === 'enum' && deletedEnums.has(cellText(row.element)))
      );
      for (const row of tables.slots ?? []) {
        if (deletedEnums.has(cellText(row.range))) {
          row.range = '';
        }
      }
    }
  }
}

function pruneMissingReferences(tables: Tables) {
  const classNames = new Set((tables.classes ?? []).map((row) => cellText(row.class)).filter(Boolean));
  const enumNames = new Set((tables.enums ?? []).map((row) => cellText(row.enum)).filter(Boolean));

  tables.slots = (tables.slots ?? []).filter((row) => {
    const className = cellText(row.class);
    return !className || classNames.has(className);
  });
  for (const row of tables.slots ?? []) {
    const enumName = cellText(row.range);
    if (enumName.endsWith('Menu') && !enumNames.has(enumName)) {
      row.range = '';
    }
  }

  const slotNames = new Set((tables.slots ?? []).map((row) => cellText(row.slot)).filter(Boolean));
  tables.permissible_values = (tables.permissible_values ?? []).filter((row) => {
    const enumName = cellText(row.enum);
    return !enumName || enumNames.has(enumName);
  });
  tables.annotations = (tables.annotations ?? []).filter((row) =>
    annotationTargetExists(row, classNames, slotNames, enumNames)
  );
}

function annotationTargetExists(row: Row, classNames: Set<string>, slotNames: Set<string>, enumNames: Set<string>) {
  const elementType = cellText(row.element_type);
  const element = cellText(row.element);
  if (!elementType || !element) return true;
  if (elementType === 'class') return classNames.has(element);
  if (elementType === 'slot') return slotNames.has(element);
  if (elementType === 'enum') return enumNames.has(element);
  return true;
}

function removeEnumAnnotationRowsNotIn(tables: Tables, enumName: string, keys: Set<string>) {
  tables.annotations = (tables.annotations ?? []).filter(
    (row) =>
      !(
        cellText(row.element_type) === 'enum' &&
        cellText(row.element) === enumName &&
        !keys.has(cellText(row.key))
      )
  );
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
  if (previous.length !== next.length) return;
  for (let index = 0; index < Math.min(previous.length, next.length); index += 1) {
    const oldName = cellText(previous[index]?.[column]);
    const nextName = cellText(next[index]?.[column]);
    if (oldName && nextName && oldName !== nextName) {
      onRename(oldName, nextName);
    }
  }
}

function deletedNames(
  previousRows: Row[] | undefined,
  nextRows: Row[] | undefined,
  column: string,
  renamed: Set<string>
) {
  const nextNames = new Set((nextRows ?? []).map((row) => cellText(row[column])).filter(Boolean));
  return new Set(
    (previousRows ?? [])
      .map((row) => cellText(row[column]))
      .filter((name) => name && !renamed.has(name) && !nextNames.has(name))
  );
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

function migrateLegacySlotRowColumns(tables: Tables) {
  for (const row of tables.slots ?? []) {
    migrateLegacySlotAnnotationColumns(row);
    for (const [legacyKey, rowKey] of Object.entries(LEGACY_SLOT_ROW_COLUMNS)) {
      if (!cellText(row[rowKey]) && cellText(row[legacyKey])) {
        row[rowKey] = row[legacyKey];
      }
      delete row[legacyKey];
    }
  }
}

function migrateLegacySlotAnnotations(tables: Tables) {
  for (const row of tables.annotations ?? []) {
    if (cellText(row.element_type) !== 'slot') continue;
    const key = LEGACY_SLOT_ANNOTATION_COLUMNS[cellText(row.key)];
    if (key) {
      row.key = key;
    }
  }
}

function slotAnnotationColumns(row: Row) {
  return Object.keys(row)
    .filter((key) => isSlotAnnotationColumn(key))
    .map((key) => annotationColumnForKey(annotationKeyForColumn(key)));
}

function annotationColumnForKey(key: string) {
  const normalizedKey = LEGACY_SLOT_ANNOTATION_COLUMNS[key] ?? key;
  return normalizedKey ? `${SLOT_ANNOTATION_COLUMN_PREFIX}${normalizedKey}` : '';
}

function annotationKeyForColumn(column: string) {
  const key = column.startsWith(SLOT_ANNOTATION_COLUMN_PREFIX)
    ? column.slice(SLOT_ANNOTATION_COLUMN_PREFIX.length)
    : column.slice(LEGACY_SLOT_ANNOTATION_COLUMN_PREFIX.length);
  return LEGACY_SLOT_ANNOTATION_COLUMNS[key] ?? key;
}

function migrateLegacySlotAnnotationColumns(row: Row) {
  for (const column of Object.keys(row)) {
    if (!isLegacySlotAnnotationColumn(column)) continue;
    const canonicalColumn = annotationColumnForKey(annotationKeyForColumn(column));
    if (!cellText(row[canonicalColumn]) && cellText(row[column])) {
      row[canonicalColumn] = row[column];
    }
    delete row[column];
  }
}

function isSlotAnnotationColumn(column: string) {
  return (
    (column.startsWith(SLOT_ANNOTATION_COLUMN_PREFIX) && column !== SLOT_ANNOTATION_COLUMN_PREFIX) ||
    isLegacySlotAnnotationColumn(column)
  );
}

function isLegacySlotAnnotationColumn(column: string) {
  return (
    column.startsWith(LEGACY_SLOT_ANNOTATION_COLUMN_PREFIX) &&
    column !== LEGACY_SLOT_ANNOTATION_COLUMN_PREFIX
  );
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
