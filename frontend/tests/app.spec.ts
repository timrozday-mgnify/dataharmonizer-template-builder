import { expect, test } from '@playwright/test';

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
