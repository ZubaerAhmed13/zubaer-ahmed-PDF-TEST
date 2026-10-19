import { expect, test } from '@playwright/test';
import { PDFDocument } from 'pdf-lib';

async function pdfFixture(label: string): Promise<Buffer> {
  const doc = await PDFDocument.create();
  const page = doc.addPage([420, 594]);
  page.drawText(label);
  return Buffer.from(await doc.save());
}

async function openMerge(page: import('@playwright/test').Page) {
  await page.setViewportSize({ width: 1100, height: 520 });
  await page.goto('/zubaer-ahmed-PDF-TEST/');
  await page.locator('[data-open-tool="merge"]').click();
  const dialog = page.getByRole('dialog', { name: 'Workspace' });
  await expect(dialog).toBeVisible();
  return dialog;
}

test('editor shell remains vertically navigable on a short desktop viewport', async ({ page }) => {
  const dialog = await openMerge(page);

  const files = [] as { name: string; mimeType: string; buffer: Buffer }[];
  for (let index = 0; index < 10; index += 1) {
    files.push({
      name: `scroll-${index + 1}.pdf`,
      mimeType: 'application/pdf',
      buffer: await pdfFixture(`Scroll fixture ${index + 1}`)
    });
  }
  await dialog.locator('#workspace-file').setInputFiles(files);

  const workspace = dialog.locator('.workspace');
  const shell = dialog.locator('.legacy-editor-shell');
  const body = dialog.locator('.legacy-editor-body');

  // This records the product-level contract the user expects: the editor must
  // not be a scroll trap when its content exceeds the available viewport.
  const before = await workspace.evaluate((node) => ({
    top: node.scrollTop,
    scrollHeight: node.scrollHeight,
    clientHeight: node.clientHeight,
    overflowY: getComputedStyle(node).overflowY
  }));

  await workspace.hover();
  await page.mouse.wheel(0, 900);
  await page.waitForTimeout(150);

  const after = await workspace.evaluate((node) => node.scrollTop);
  const shellOverflow = await shell.evaluate((node) => getComputedStyle(node).overflowY);
  const bodyOverflow = await body.evaluate((node) => getComputedStyle(node).overflowY);

  expect.soft(before.overflowY, 'workspace must not globally suppress editor scrolling').not.toBe('hidden');
  expect.soft(shellOverflow, 'editor shell must not globally suppress scrolling').not.toBe('hidden');
  expect.soft(bodyOverflow, 'editor body must not be a wheel/touch scroll trap').not.toBe('hidden');

  if (before.scrollHeight > before.clientHeight) {
    expect(after, 'mouse-wheel scrolling over the editor should move the editor').toBeGreaterThan(before.top);
  }
});

test('file pane actually responds to wheel scrolling after many source files are added', async ({ page }) => {
  const dialog = await openMerge(page);
  const files = [] as { name: string; mimeType: string; buffer: Buffer }[];
  for (let index = 0; index < 12; index += 1) {
    files.push({
      name: `many-${index + 1}.pdf`,
      mimeType: 'application/pdf',
      buffer: await pdfFixture(`Many ${index + 1}`)
    });
  }
  await dialog.locator('#workspace-file').setInputFiles(files);

  const pane = dialog.locator('.legacy-files-pane');
  const dimensions = await pane.evaluate((node) => ({ scrollHeight: node.scrollHeight, clientHeight: node.clientHeight }));
  expect(dimensions.scrollHeight).toBeGreaterThan(dimensions.clientHeight);

  const before = await pane.evaluate((node) => node.scrollTop);
  await pane.hover();
  await page.mouse.wheel(0, 700);
  await page.waitForTimeout(150);
  const after = await pane.evaluate((node) => node.scrollTop);
  expect(after).toBeGreaterThan(before);
});
