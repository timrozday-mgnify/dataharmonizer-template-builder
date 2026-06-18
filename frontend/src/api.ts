import type { GenerateResponse, ImportResponse, Tables } from './types';

const API_BASE = import.meta.env.VITE_API_BASE ?? '';

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const response = await fetch(`${API_BASE}${path}`, {
    headers: { 'Content-Type': 'application/json', ...(init?.headers ?? {}) },
    ...init
  });
  if (!response.ok) {
    const text = await response.text();
    throw new Error(text || response.statusText);
  }
  return response.json() as Promise<T>;
}

export function importSchema(yaml: string): Promise<ImportResponse> {
  return request<ImportResponse>('/api/schemas/import', {
    method: 'POST',
    body: JSON.stringify({ yaml })
  });
}

export function updateTables(sessionId: string, tables: Tables): Promise<ImportResponse> {
  return request<ImportResponse>(`/api/sessions/${sessionId}/tables`, {
    method: 'POST',
    body: JSON.stringify({ tables })
  });
}

export function generateSchema(sessionId: string, tables: Tables): Promise<GenerateResponse> {
  return request<GenerateResponse>(`/api/sessions/${sessionId}/generate`, {
    method: 'POST',
    body: JSON.stringify({ tables })
  });
}
