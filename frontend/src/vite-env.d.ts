/// <reference types="vite/client" />

declare module 'data-harmonizer' {
  export class AppContext {
    constructor(appConfig?: { template_path?: string });
    reload(templatePath: string, locale?: string | null, forcedSchema?: Record<string, unknown>): Promise<AppContext>;
    getLocaleData(template?: unknown): unknown;
    clearContext?(): void;
    clearInterface?(): void;
  }

  export class Toolbar {
    constructor(
      root: Element,
      context: AppContext,
      options?: {
        templatePath?: string;
        getLanguages?: (...args: unknown[]) => unknown;
        getExportFormats?: (...args: unknown[]) => unknown;
        getSchema?: (...args: unknown[]) => unknown;
      }
    );
  }

  export class Footer {
    constructor(root: Element, context: AppContext);
  }
}

declare module 'data-harmonizer/data-harmonizer.css';

declare module 'jquery' {
  const jquery: unknown;
  export default jquery;
}

interface Window {
  $?: unknown;
  jQuery?: unknown;
}
