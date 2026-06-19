import { expect, test } from '@playwright/test';

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

async function importDemoSchema(page: Parameters<Parameters<typeof test>[1]>[0]['page']) {
  await page.getByRole('button', { name: 'Import YAML' }).first().click();
  await expect(page.getByRole('dialog', { name: 'Import YAML' })).toBeVisible();
  await page.locator('.popup-actions').getByRole('button', { name: 'Load schema' }).click();
  await expect(page.locator('.schema-name')).toHaveText('template_builder_demo');
}

test('opens the schema editor shell', async ({ page }) => {
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
  await page.goto('/');

  await importDemoSchema(page);
  await expect(page.locator('.schema-name')).toHaveText('template_builder_demo');
  await expect(page.getByRole('button', { name: 'Preview', exact: true })).toBeEnabled();

  await page.getByRole('button', { name: 'Preview', exact: true }).click();

  await expect(page.locator('#data-harmonizer-grid'), browserMessages.join('\n')).toContainText('Sample ID', {
    timeout: 10_000
  });
  await expect(page.locator('#data-harmonizer-grid')).toContainText('Status');
  await expect(page.getByRole('tab', { name: 'Demo' })).toBeVisible();
  await expect(page.locator('#data-harmonizer-toolbar #validate-btn')).toBeEnabled();
  await expect(page.locator('#data-harmonizer-footer #add-row')).toBeEnabled();
});

test('edits enum values in the focused enum workspace', async ({ page }) => {
  await page.goto('/');

  await importDemoSchema(page);
  await page.getByRole('button', { name: 'Enum workspace' }).click();

  await expect(page.getByRole('button', { name: /StatusMenu/ })).toBeVisible();
  await expect(page.locator('.enum-values input[value="draft"]').first()).toBeVisible();
  await expect(page.locator('.enum-values input[value="ready"]').first()).toBeVisible();

  await page.getByRole('button', { name: /Add/ }).click();
  const newRow = page.locator('.enum-values tbody tr').last();
  await newRow.locator('input').nth(0).fill('archived');
  await newRow.locator('input').nth(1).fill('archived');

  await page.locator('.enum-meta label').first().locator('input').fill('StatusChoiceMenu');
  await page.getByRole('button', { name: 'Generate' }).click();
  await page.getByRole('button', { name: 'Export YAML' }).first().click();

  await expect(page.locator('.generated-output')).toContainText('StatusChoiceMenu');
  await expect(page.locator('.generated-output')).toContainText('archived');
});

test('keeps focus while typing in editable grid cells', async ({ page }) => {
  await page.goto('/');

  await importDemoSchema(page);
  await page.getByRole('button', { name: 'Enum workspace' }).click();
  await page.getByRole('button', { name: /Add/ }).click();

  const valueInput = page.locator('.enum-values tbody tr').last().locator('input').first();
  await valueInput.fill('');
  await valueInput.type('typing_check');
  await expect(valueInput).toBeFocused();
  await expect(valueInput).toHaveValue('typing_check');
});

test('allows text entry in the DataHarmonizer preview grid', async ({ page }) => {
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
