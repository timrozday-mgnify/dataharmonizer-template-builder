let dataHarmonizerLibraryPromise: ReturnType<typeof importDataHarmonizerLibrary> | null = null;

export async function loadDataHarmonizerLibrary() {
  dataHarmonizerLibraryPromise ??= importDataHarmonizerLibrary();
  return dataHarmonizerLibraryPromise;
}

async function importDataHarmonizerLibrary() {
  const jqueryModule = await import('jquery');
  const jquery = jqueryModule.default;
  window.$ = jquery;
  window.jQuery = jquery;
  return import('data-harmonizer');
}
