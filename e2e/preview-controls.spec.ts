import { expect, test } from '@playwright/test';
import { PDFDocument } from 'pdf-lib';

async function fixture(): Promise<Buffer> {
  const doc = await PDFDocument.create();
  doc.addPage([420, 680]);
  doc.addPage([500, 700]);
  doc.addPage([595.28, 841.89]);
  return Buffer.from(await doc.save());
}

test('preview supports zoom modes, keyboard page navigation and boundary wheel navigation', async ({ page }) => {
  await page.goto('/zubaer-ahmed-PDF-TEST/');
  await page.getByLabel('Search tools').fill('view pdf');
  await page.locator('#tool-grid [data-open-tool="preview"]').click();
  const dialog = page.getByRole('dialog', { name: 'Workspace' });
  await dialog.locator('#workspace-file').setInputFiles({ name: 'preview-controls.pdf', mimeType: 'application/pdf', buffer: await fixture() });
  await dialog.getByRole('button', { name: 'Run View PDF' }).click();
  await expect(dialog.locator('#stage')).toHaveText('Preview ready');
  await expect(dialog.locator('#viewer-status')).toHaveText('Page 1 of 3');
  await expect(dialog.locator('#zoom-level')).toHaveText('125%');

  const initial = await dialog.locator('#pdf-canvas').evaluate((canvas: HTMLCanvasElement) => canvas.getBoundingClientRect().width);
  await dialog.getByRole('button', { name: 'Zoom in' }).click();
  await expect(dialog.locator('#zoom-level')).toHaveText('150%');
  const zoomed = await dialog.locator('#pdf-canvas').evaluate((canvas: HTMLCanvasElement) => canvas.getBoundingClientRect().width);
  expect(zoomed).toBeGreaterThan(initial);

  await dialog.getByRole('button', { name: 'Actual size' }).click();
  await expect(dialog.locator('#zoom-level')).toHaveText('100%');

  await dialog.getByRole('button', { name: 'Fit width' }).click();
  const fitted = await dialog.locator('.canvas-shell').evaluate((shell) => {
    const canvas = shell.querySelector('canvas');
    if (!canvas) throw new Error('Preview canvas missing.');
    return { canvas: canvas.getBoundingClientRect().width, shell: shell.clientWidth };
  });
  expect(fitted.canvas).toBeLessThanOrEqual(fitted.shell);

  const shell = dialog.locator('.canvas-shell');
  await shell.focus();
  await page.keyboard.press('ArrowRight');
  await expect(dialog.locator('#viewer-status')).toHaveText('Page 2 of 3');
  await page.keyboard.press('End');
  await expect(dialog.locator('#viewer-status')).toHaveText('Page 3 of 3');
  await page.keyboard.press('Home');
  await expect(dialog.locator('#viewer-status')).toHaveText('Page 1 of 3');

  await dialog.getByRole('button', { name: 'Fit page' }).click();
  await shell.evaluate((element) => { element.scrollTop = element.scrollHeight; });
  await shell.dispatchEvent('wheel', { deltaY: 180 });
  await expect(dialog.locator('#viewer-status')).toHaveText('Page 2 of 3');
});
