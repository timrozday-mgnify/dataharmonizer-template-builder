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
});

test('edits enum values in the focused enum workspace', async ({ page }) => {
  await routeStandaloneFrontendConfig(page);
  await page.goto('/');

  await importDemoSchema(page);
  await page.getByRole('button', { name: 'Enum workspace' }).click();

  await expect(page.getByRole('button', { name: /StatusMenu/ })).toBeVisible();
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
