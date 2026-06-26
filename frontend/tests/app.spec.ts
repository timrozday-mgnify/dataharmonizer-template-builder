import { expect, test, type Locator, type Page } from '@playwright/test';

const HOST_SCHEMA = `id: https://example.org/host-demo
name: host_demo
imports:
- linkml:types
prefixes:
  linkml: https://w3id.org/linkml/
default_range: string
classes:
  dh_interface:
    description: A DataHarmonizer interface
  HostDemo:
    is_a: dh_interface
    slots:
    - host_id
slots:
  host_id:
    title: Host ID
    range: string
    required: true
`;

const ANNOTATED_SCHEMA = `id: https://example.org/annotation-demo
name: annotation_demo
imports:
- linkml:types
prefixes:
  linkml: https://w3id.org/linkml/
default_range: string
classes:
  Demo:
    slots:
    - sample_id
slots:
  sample_id:
    title: Sample ID
    range: string
    annotations:
      id: sample_id
      default_unit: mL
`;

const TWO_SLOT_ANNOTATED_SCHEMA = `id: https://example.org/annotation-sync-demo
name: annotation_sync_demo
imports:
- linkml:types
prefixes:
  linkml: https://w3id.org/linkml/
default_range: string
classes:
  Demo:
    slots:
    - sample_id
    - sample_weight
slots:
  sample_id:
    title: Sample ID
    range: string
    annotations:
      default_unit: mL
  sample_weight:
    title: Sample Weight
    range: string
`;

async function importDemoSchema(page: Page) {
  await page.getByRole('button', { name: 'Import YAML' }).first().click();
  await expect(page.getByRole('dialog', { name: 'Import YAML' })).toBeVisible();
  await page.locator('.popup-actions').getByRole('button', { name: 'Load schema' }).click();
  await expect(page.locator('.schema-name')).toHaveText('template_builder_demo');
}

async function routeStandaloneFrontendConfig(page: Page) {
  await page.route('**/api/frontend-config', async (route) => {
    await route.fulfill({
      contentType: 'application/json',
      body: JSON.stringify({
        showImportButton: true,
        showExportButton: true,
        showGenerateButton: true,
        showPreviewButton: true,
        showDiagnostics: true,
        allowExampleSchema: true,
        hostName: '',
        hostMode: 'standalone'
      })
    });
  });
}

test('opens the schema editor shell', async ({ page }) => {
  await routeStandaloneFrontendConfig(page);
  await page.goto('/');
  await expect(page.getByRole('heading', { name: 'Template Builder' })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Import YAML' }).first()).toBeVisible();
  await expect(page.getByRole('button', { name: 'Export YAML' }).first()).toBeVisible();
  await importDemoSchema(page);
  await expectHotGridVisible(page.locator('.table-panel .hot-grid-wrap').first());
  await expectMeasuredColumnWidths(page);
  await expectRowHeightsStableDuringHorizontalScroll(page);
  await expect(page.getByRole('button', { name: 'Preview', exact: true })).toBeEnabled();
  await expect(page.getByRole('button', { name: 'Validate' })).toHaveCount(0);
});

test('renders a generated schema in a DataHarmonizer preview grid', async ({ page }) => {
  const browserMessages: string[] = [];
  page.on('console', (message) => browserMessages.push(`${message.type()}: ${message.text()}`));
  page.on('pageerror', (error) => browserMessages.push(`pageerror: ${error.message}`));
  await routeStandaloneFrontendConfig(page);
  await page.goto('/');

  await importDemoSchema(page);
  await expect(page.locator('.schema-name')).toHaveText('template_builder_demo');
  await expect(page.getByRole('button', { name: 'Preview', exact: true })).toBeEnabled();

  await page.getByRole('button', { name: 'Preview', exact: true }).click();

  await expect(page.locator('#data-harmonizer-grid'), browserMessages.join('\n')).toContainText('Sample ID', {
    timeout: 20_000
  });
  await expect(page.locator('#data-harmonizer-grid')).toContainText('Status');
  await expect(page.getByRole('tab', { name: 'Demo' })).toBeVisible();
  await expect(page.locator('#data-harmonizer-toolbar #validate-btn')).toBeEnabled();
  await expect(page.locator('#data-harmonizer-footer #add-row')).toBeEnabled();
  await expectPreviewCellsDoNotWrap(page);
  await expectPreviewRowHeightsStableDuringHorizontalScroll(page);
});

test('edits enum values in the focused enum workspace', async ({ page }) => {
  await routeStandaloneFrontendConfig(page);
  await page.goto('/');

  await importDemoSchema(page);
  await page.getByRole('button', { name: 'Enum workspace' }).click();

  await expect(page.getByRole('button', { name: /StatusMenu/ })).toBeVisible();
  await expectHotGridVisible(page.locator('.enum-values .hot-grid-wrap'));
  await expect(page.locator('.enum-values .ht_master .htCore tbody')).toContainText('draft');
  await expect(page.locator('.enum-values .ht_master .htCore tbody')).toContainText('ready');

  await page.getByRole('button', { name: /Add/ }).click();
  const newRow = page.locator('.enum-values .ht_master .htCore tbody tr').last();
  await fillHotCell(newRow.locator('td', { hasText: 'new_value' }).filter({ visible: true }).first(), 'archived');

  await page.locator('.enum-meta label').first().locator('input').fill('StatusChoiceMenu');
  await page.getByRole('button', { name: 'Generate' }).click();
  await page.getByRole('button', { name: 'Export YAML' }).first().click();

  await expect(page.locator('.generated-output')).toContainText('StatusChoiceMenu');
  await expect(page.locator('.generated-output')).toContainText('archived');
});

test('syncs raw enum table renames to linked tables', async ({ page }) => {
  await routeStandaloneFrontendConfig(page);
  await page.goto('/');

  await importDemoSchema(page);
  await page.getByRole('button', { name: 'enums' }).click();
  const enumCell = page
    .locator('.table-panel .ht_master .htCore tbody tr')
    .first()
    .locator('td', { hasText: 'StatusMenu' })
    .filter({ visible: true })
    .first();
  await replaceHotCell(enumCell, 'StatusRawMenu');

  await page.getByRole('button', { name: 'Generate' }).click();
  await page.getByRole('button', { name: 'Export YAML' }).first().click();

  await expect(page.locator('.generated-output')).toContainText('StatusRawMenu');
  await expect(page.locator('.generated-output')).not.toContainText('StatusMenu');
});

test('undoes and redoes synced table edits as one shared history action', async ({ page }) => {
  await routeStandaloneFrontendConfig(page);
  await page.goto('/');

  await importDemoSchema(page);
  await page.getByRole('button', { name: 'enums' }).click();
  const enumCell = page
    .locator('.table-panel .ht_master .htCore tbody tr')
    .first()
    .locator('td', { hasText: 'StatusMenu' })
    .filter({ visible: true })
    .first();
  await replaceHotCell(enumCell, 'StatusRawMenu');

  await page.getByRole('button', { name: 'slots' }).click();
  const slotCell = page
    .locator('.table-panel .ht_master .htCore tbody tr')
    .filter({ hasText: 'status' })
    .locator('td', { hasText: 'StatusRawMenu' })
    .filter({ visible: true })
    .first();
  await expect(slotCell).toBeVisible();
  await clickHotCell(slotCell);

  await page.keyboard.press('Control+Z');
  await expect(page.locator('.table-panel .panel-heading h2')).toHaveText('enums');
  await expect(page.locator('.table-panel .ht_master .htCore tbody')).toContainText('StatusMenu');

  await page.keyboard.press('Control+Y');
  await expect(page.locator('.table-panel .ht_master .htCore tbody')).toContainText('StatusRawMenu');

  await page.getByRole('button', { name: 'slots' }).click();
  await expect(page.locator('.table-panel .ht_master .htCore tbody')).toContainText('StatusRawMenu');
});

test('supports shift-z redo and clears history after successful generation', async ({ page }) => {
  await routeStandaloneFrontendConfig(page);
  await page.goto('/');

  await importDemoSchema(page);
  const sampleCell = page
    .locator('.table-panel .ht_master .htCore tbody tr')
    .first()
    .locator('td', { hasText: 'sample_id' })
    .filter({ visible: true })
    .first();
  await replaceHotCell(sampleCell, 'sample_code');

  await page.keyboard.press('Control+Z');
  await expect(page.locator('.table-panel .ht_master .htCore tbody')).toContainText('sample_id');
  await page.keyboard.press('Control+Shift+Z');
  await expect(page.locator('.table-panel .ht_master .htCore tbody')).toContainText('sample_code');

  await page.getByRole('button', { name: 'Generate' }).click();
  await clickHotCell(page.locator('.table-panel .ht_master .htCore tbody td', { hasText: 'sample_code' }).filter({ visible: true }).first());
  await page.keyboard.press('Control+Z');
  await expect(page.locator('.table-panel .ht_master .htCore tbody')).toContainText('sample_code');
});

test('syncs annotation table edits into generated slot annotations', async ({ page }) => {
  await routeStandaloneFrontendConfig(page);
  await page.goto('/');

  await page.getByRole('button', { name: 'Import YAML' }).first().click();
  await page.locator('.popup-textarea').fill(ANNOTATED_SCHEMA);
  await page.locator('.popup-actions').getByRole('button', { name: 'Load schema' }).click();
  await expect(page.locator('.schema-name')).toHaveText('annotation_demo');
  await page.getByRole('button', { name: 'annotations' }).click();
  const unitCell = page
    .locator('.table-panel .ht_master .htCore tbody tr')
    .locator('td', { hasText: 'mL' })
    .filter({ visible: true })
    .first();
  await replaceHotCell(unitCell, 'uL');

  await page.getByRole('button', { name: 'Generate' }).click();
  await page.getByRole('button', { name: 'Export YAML' }).first().click();

  await expect(page.locator('.generated-output')).toContainText('uL');
});

test('keeps row hit testing aligned after slot annotation sync inserts rows', async ({ page }) => {
  await routeStandaloneFrontendConfig(page);
  await page.goto('/');

  await page.getByRole('button', { name: 'Import YAML' }).first().click();
  await page.locator('.popup-textarea').fill(TWO_SLOT_ANNOTATED_SCHEMA);
  await page.locator('.popup-actions').getByRole('button', { name: 'Load schema' }).click();
  await expect(page.locator('.schema-name')).toHaveText('annotation_sync_demo');

  await fillSlotAnnotationCell(page, 'mL', 1, 'g');
  await page.getByRole('button', { name: 'annotations' }).click();

  const syncedRow = page.locator('.table-panel .ht_master .htCore tbody tr').filter({ hasText: 'sample_weight' }).first();
  await expect(syncedRow).toContainText('g');
  const targetCell = syncedRow.locator('td', { hasText: 'sample_weight' }).filter({ visible: true }).first();
  await clickNearTopEdge(targetCell, page);

  await expect(page.locator('.table-panel .ht_master .htCore tbody td.current').first()).toContainText('sample_weight');
});

test('keeps editor table visible after repeated table switches', async ({ page }) => {
  const browserMessages: string[] = [];
  page.on('console', (message) => browserMessages.push(`${message.type()}: ${message.text()}`));
  page.on('pageerror', (error) => browserMessages.push(`pageerror: ${error.message}`));
  await routeStandaloneFrontendConfig(page);
  await page.goto('/');

  await importDemoSchema(page);
  for (const tableName of ['annotations', 'enums', 'permissible values', 'slots', 'classes', 'slots', 'annotations', 'enums']) {
    await page.getByRole('button', { name: tableName }).click();
    await expect(page.locator('.table-panel')).toBeVisible();
  }

  await expectHotGridVisible(page.locator('.table-panel .hot-grid-wrap').first());
  expect(browserMessages.join('\n')).not.toContain('TD or TH was expected');
});

test('keeps focus while typing in editable grid cells', async ({ page }) => {
  await routeStandaloneFrontendConfig(page);
  await page.goto('/');

  await importDemoSchema(page);
  await page.getByRole('button', { name: 'Enum workspace' }).click();
  await page.getByRole('button', { name: /Add/ }).click();

  const valueCell = page
    .locator('.enum-values .ht_master .htCore tbody tr')
    .last()
    .locator('td', { hasText: 'new_value' })
    .filter({ visible: true })
    .first();
  await clickHotCell(valueCell);
  await page.keyboard.press('F2');
  await page.keyboard.type('typing_check');
  await page.keyboard.press('Enter');
  await expect(valueCell).toContainText('typing_check');
});

test('keeps the Handsontable context menu open after right click', async ({ page }) => {
  await routeStandaloneFrontendConfig(page);
  await page.goto('/');

  await importDemoSchema(page);
  const firstCell = page
    .locator('.table-panel .ht_clone_inline_start .htCore tbody tr')
    .first()
    .locator('td', { hasText: 'sample_id' });
  await firstCell.click();
  await firstCell.click({ button: 'right' });

  const contextMenu = page.locator('.htContextMenu').filter({ hasText: 'Insert row above' });
  await expect(contextMenu).toBeVisible();
  await page.waitForTimeout(250);
  await expect(contextMenu).toBeVisible();
});

test('keeps the fill handle active while dragging cells', async ({ page }) => {
  await routeStandaloneFrontendConfig(page);
  await page.goto('/');

  await importDemoSchema(page);
  await page.getByRole('button', { name: 'Enum workspace' }).click();

  const valueCells = page.locator('.enum-values .ht_master .htCore tbody tr').locator('td').filter({ visible: true });
  const sourceCell = valueCells.filter({ hasText: 'draft' }).first();
  const targetCell = valueCells.filter({ hasText: 'ready' }).first();
  await sourceCell.click();

  const fillHandle = page.locator('.corner').filter({ visible: true }).first();
  await expect(fillHandle).toBeVisible();
  await dragLocatorTowardCell(fillHandle, targetCell, page);
  await expect(page.locator('.wtBorder.fill').filter({ visible: true }).first()).toBeVisible();
  await page.mouse.up();
});

test('allows text entry in the DataHarmonizer preview grid', async ({ page }) => {
  await routeStandaloneFrontendConfig(page);
  await page.goto('/');

  await importDemoSchema(page);
  await page.getByRole('button', { name: 'Preview', exact: true }).click();
  await expect(page.locator('#data-harmonizer-grid')).toContainText('Sample ID');

  const firstDataCell = page
    .locator('#data-harmonizer-grid .ht_master .htCore tbody tr')
    .first()
    .locator('td')
    .first();
  const startedAt = Date.now();
  await firstDataCell.dblclick();
  await page.keyboard.type('preview_value');
  await page.keyboard.press('Enter');

  await expect(firstDataCell).toContainText('preview_value');
  expect(Date.now() - startedAt).toBeLessThan(2000);
});

test('shows a selection border in the DataHarmonizer preview grid', async ({ page }) => {
  await routeStandaloneFrontendConfig(page);
  await page.goto('/');

  await importDemoSchema(page);
  await page.getByRole('button', { name: 'Preview', exact: true }).click();
  await expect(page.locator('#data-harmonizer-grid')).toContainText('Sample ID');

  const firstDataCell = page
    .locator('#data-harmonizer-grid .ht_master .htCore tbody tr')
    .first()
    .locator('td')
    .first();
  await firstDataCell.click();
  await expect(page.locator('#data-harmonizer-grid .wtBorder.current').filter({ visible: true }).first()).toBeVisible();
});

test('runs native DataHarmonizer validation in the preview grid', async ({ page }) => {
  await routeStandaloneFrontendConfig(page);
  await page.goto('/');

  await importDemoSchema(page);
  await page.getByRole('button', { name: 'Preview', exact: true }).click();
  await expect(page.locator('#data-harmonizer-grid')).toContainText('Sample ID');

  const firstDataCell = page
    .locator('#data-harmonizer-grid .ht_master .htCore tbody tr')
    .first()
    .locator('td')
    .first();
  await firstDataCell.dblclick();
  await page.keyboard.type('preview_value');
  await page.keyboard.press('Enter');

  await page.locator('#data-harmonizer-toolbar #validate-btn').click();
  await expect(page.locator('#data-harmonizer-toolbar #next-error-button')).toBeVisible();
  const invalidCell = page
    .locator('#data-harmonizer-grid .ht_master .htCore tbody tr')
    .first()
    .locator('td')
    .nth(1);
  await expect(invalidCell).toHaveClass(/empty-invalid-cell|invalid-cell/);
  await expect(invalidCell).toHaveCSS('background-color', 'rgb(255, 145, 164)');
});

test('uses backend frontend config to hide host-managed controls', async ({ page }) => {
  await page.route('**/api/frontend-config', async (route) => {
    await route.fulfill({
      contentType: 'application/json',
      body: JSON.stringify({
        showImportButton: false,
        showExportButton: false,
        showGenerateButton: true,
        showPreviewButton: true,
        showDiagnostics: true,
        allowExampleSchema: false,
        hostName: 'MIMICC',
        hostMode: 'embedded'
      })
    });
  });

  await page.goto('/');

  await expect(page.getByText('MIMICC')).toBeVisible();
  await expect(page.getByRole('button', { name: 'Import YAML' })).toHaveCount(0);
  await expect(page.getByRole('button', { name: 'Export YAML' })).toHaveCount(0);
  await expect(page.getByText('Waiting for schema from host.')).toBeVisible();
});

test('supports iframe-style YAML load and export messages', async ({ page }) => {
  await routeStandaloneFrontendConfig(page);
  await page.goto('/');

  const loaded = await page.evaluate(async (yaml) => {
    return new Promise<Record<string, unknown>>((resolve, reject) => {
      const timer = window.setTimeout(() => reject(new Error('Timed out waiting for dhtb.loaded')), 10_000);
      const listener = (event: MessageEvent) => {
        if (event.data?.type === 'dhtb.loaded') {
          window.clearTimeout(timer);
          window.removeEventListener('message', listener);
          resolve(event.data);
        }
      };
      window.addEventListener('message', listener);
      window.postMessage({ type: 'dhtb.loadYaml', yaml, name: 'host_loaded', sourceId: 'host:demo' }, '*');
    });
  }, HOST_SCHEMA);

  expect(loaded.schemaName).toBe('host_loaded');
  await expect(page.locator('.schema-name')).toHaveText('host_loaded');

  const exported = await page.evaluate(async () => {
    return new Promise<Record<string, unknown>>((resolve, reject) => {
      const timer = window.setTimeout(() => reject(new Error('Timed out waiting for dhtb.exported')), 10_000);
      const listener = (event: MessageEvent) => {
        if (event.data?.type === 'dhtb.exported') {
          window.clearTimeout(timer);
          window.removeEventListener('message', listener);
          resolve(event.data);
        }
      };
      window.addEventListener('message', listener);
      window.postMessage({ type: 'dhtb.exportYaml' }, '*');
    });
  });

  expect(exported.type).toBe('dhtb.exported');
  expect(exported.yaml).toContain('host_id');
});

async function fillHotCell(cell: Locator, value: string) {
  await clickHotCell(cell);
  await cell.page().keyboard.press('F2');
  await cell.page().keyboard.type(value);
  await cell.page().keyboard.press('Enter');
}

async function replaceHotCell(cell: Locator, value: string) {
  await clickHotCell(cell);
  await cell.page().keyboard.press('F2');
  await cell.page().keyboard.press('ControlOrMeta+A');
  await cell.page().keyboard.type(value);
  await cell.page().keyboard.press('Enter');
}

async function fillSlotAnnotationCell(page: Page, visibleAnchorText: string, targetRowIndex: number, value: string) {
  await page.locator('.table-panel .ht_master .wtHolder').first().evaluate((element) => {
    element.scrollLeft = element.scrollWidth;
    element.dispatchEvent(new Event('scroll', { bubbles: true }));
  });
  const anchorCell = page
    .locator('.table-panel .ht_master .htCore tbody tr')
    .first()
    .locator('td', { hasText: visibleAnchorText })
    .filter({ visible: true })
    .first();
  await expect(anchorCell).toBeVisible();
  const anchorBox = await anchorCell.boundingBox();
  if (!anchorBox) throw new Error('Could not locate annotation anchor cell.');

  const targetRow = page.locator('.table-panel .ht_master .htCore tbody tr').nth(targetRowIndex);
  const targetColumnIndex = await targetRow.locator('td').evaluateAll((cells, anchorCenterX) => {
    return cells.findIndex((cell) => {
      const rect = cell.getBoundingClientRect();
      return rect.left <= anchorCenterX && anchorCenterX <= rect.right;
    });
  }, anchorBox.x + anchorBox.width / 2);
  if (targetColumnIndex < 0) throw new Error('Could not locate target annotation cell.');
  await replaceHotCell(targetRow.locator('td').nth(targetColumnIndex), value);
}

async function clickNearTopEdge(cell: Locator, page: Page) {
  const box = await cell.boundingBox();
  if (!box) throw new Error('Could not determine cell coordinates.');
  await page.mouse.click(box.x + box.width / 2, box.y + 1);
}

async function expectHotGridVisible(grid: Locator) {
  await expect(grid).toBeVisible();
  const box = await grid.boundingBox();
  expect(box?.width ?? 0).toBeGreaterThan(100);
  expect(box?.height ?? 0).toBeGreaterThan(100);
}

async function expectMeasuredColumnWidths(page: Page) {
  const widths = await page.locator('.table-panel .ht_master .htCore colgroup col').evaluateAll((columns) =>
    columns.slice(1, 6).map((column) => Number.parseFloat((column as HTMLTableColElement).style.width))
  );
  expect(widths.length).toBeGreaterThan(0);
  for (const width of widths) {
    expect(width).toBeGreaterThanOrEqual(90);
    expect(width).toBeLessThanOrEqual(420);
  }
  expect(new Set(widths).size).toBeGreaterThan(1);
}

async function expectRowHeightsStableDuringHorizontalScroll(page: Page) {
  const holder = page.locator('.table-panel .ht_master .wtHolder').first();
  const before = await visibleRowHeights(page);
  await holder.evaluate((element) => {
    element.scrollLeft = 900;
    element.dispatchEvent(new Event('scroll', { bubbles: true }));
  });
  await page.waitForTimeout(100);
  const after = await visibleRowHeights(page);
  expect(after).toEqual(before);
}

async function visibleRowHeights(page: Page) {
  return page.locator('.table-panel .ht_master .htCore tbody tr').evaluateAll((rows) =>
    rows.map((row) => Math.round(row.getBoundingClientRect().height))
  );
}

async function expectPreviewCellsDoNotWrap(page: Page) {
  const firstCell = page.locator('#data-harmonizer-grid .ht_master .htCore tbody td').first();
  await expect(firstCell).toHaveCSS('white-space', 'nowrap');
  await expect(firstCell).toHaveCSS('text-overflow', 'ellipsis');
}

async function expectPreviewRowHeightsStableDuringHorizontalScroll(page: Page) {
  const holder = page.locator('#data-harmonizer-grid .ht_master .wtHolder').first();
  const before = await visiblePreviewRowHeights(page);
  await holder.evaluate((element) => {
    element.scrollLeft = 900;
    element.dispatchEvent(new Event('scroll', { bubbles: true }));
  });
  await page.waitForTimeout(100);
  const after = await visiblePreviewRowHeights(page);
  expect(after).toEqual(before);
}

async function visiblePreviewRowHeights(page: Page) {
  return page.locator('#data-harmonizer-grid .ht_master .htCore tbody tr').evaluateAll((rows) =>
    rows.map((row) => Math.round(row.getBoundingClientRect().height))
  );
}

async function clickHotCell(cell: Locator) {
  await cell.evaluate((element) => {
    for (const type of ['mousedown', 'mouseup', 'click', 'dblclick']) {
      element.dispatchEvent(
        new MouseEvent(type, {
          bubbles: true,
          cancelable: true,
          button: 0,
          buttons: type === 'mousedown' ? 1 : 0
        })
      );
    }
  });
}

async function dragLocatorTowardCell(source: Locator, target: Locator, page: Page) {
  const sourceBox = await source.boundingBox();
  const targetBox = await target.boundingBox();
  if (!sourceBox || !targetBox) {
    throw new Error('Could not determine drag coordinates.');
  }
  await page.mouse.move(sourceBox.x + sourceBox.width / 2, sourceBox.y + sourceBox.height / 2);
  await page.mouse.down();
  await page.mouse.move(targetBox.x + targetBox.width / 2, targetBox.y + targetBox.height - 2, { steps: 12 });
}
