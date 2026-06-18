export type Diagnostic = {
  level: string;
  message: string;
  table?: string | null;
  row?: number | null;
  column?: string | null;
  path?: string | null;
};

export type Row = Record<string, string | number | boolean | null | undefined>;

export type Tables = Record<string, Row[]>;

export type ImportResponse = {
  session_id: string;
  schema_name: string;
  tables: Tables;
  diagnostics: Diagnostic[];
};

export type GenerateResponse = {
  yaml: string;
  schema: Record<string, unknown>;
  schema_json: Record<string, unknown>;
  diagnostics: Diagnostic[];
};
