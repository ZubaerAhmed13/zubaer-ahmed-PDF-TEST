import { expect, test } from '@playwright/test';
import { PDFDocument } from 'pdf-lib';

const base = '/zubaer-ahmed-PDF-TEST/';
async function pdfPages() {
  const doc = await PDFDocument.create();
  for (let i = 0; i < 4; i += 1) doc.addPage([400 + i, 600]);
  return { name: 'pages.pdf', mimeType: 'application/pdf', buffer: Buffer.from(await doc.save()) };
}

test('thumbnail click and Shift-click select a page range without changing the actual PDF order', async ({ page }) => {
  await page.goto(base + '#/tools/organize');
  await page.locator('#workspace-file').setInputFiles(await pdfPages());
  const grid = page.locator('[data-organizer-grid]');
  await expect(page.locator('.organizer-panel')).toHaveAttribute('data-organizer-ready','true');
  const cards = grid.locator('.organizer-card');
  await expect(cards).toHaveCount(4);
  await cards.nth(0).locator('[data-toggle-item]').click();
  await cards.nth(2).locator('[data-toggle-item]').click({ modifiers: ['Shift'] });
  await expect(cards.nth(0).locator('[data-toggle-item]')).toHaveAttribute('aria-pressed','true');
  await expect(cards.nth(1).locator('[data-toggle-item]')).toHaveAttribute('aria-pressed','true');
  await expect(cards.nth(2).locator('[data-toggle-item]')).toHaveAttribute('aria-pressed','true');
  await expect(cards.nth(3).locator('[data-toggle-item]')).toHaveAttribute('aria-pressed','false');
  await expect(page.locator('input[name="order"]')).toHaveValue('1,2,3,4');
  await expect(page.locator('.organizer-summary')).toContainText('3 selected');
  await page.getByRole('button',{name:'Delete selected'}).click();
  await expect(cards).toHaveCount(1);
  await expect(page.locator('input[name="order"]')).toHaveValue('4');
  await page.getByRole('button',{name:'Undo',exact:true}).click();
  await expect(page.locator('input[name="order"]')).toHaveValue('1,2,3,4');
});

test('a full-page preview opens and closes without losing the organizer or source PDF', async ({ page }) => {
  await page.goto(base + '#/tools/organize');
  await page.locator('#workspace-file').setInputFiles(await pdfPages());
  await expect(page.locator('.organizer-panel')).toHaveAttribute('data-organizer-ready','true');
  const trigger = page.getByRole('button',{name:'Preview source page 2'});
  await trigger.click();
  const preview = page.getByRole('dialog',{name:'Source page 2'});
  await expect(preview).toBeVisible();
  await expect(preview.locator('[data-preview-status]')).not.toContainText('Rendering larger preview…');
  const canvasWidth = await preview.locator('[data-preview-canvas]').evaluate((element) => (element as HTMLCanvasElement).width);
  expect(canvasWidth).toBeGreaterThan(100);
  await preview.getByRole('button',{name:'Select this page'}).click();
  await expect(preview).toBeHidden();
  await expect(page.locator('.organizer-card').nth(1).locator('[data-toggle-item]')).toHaveAttribute('aria-pressed','true');
  await expect(page.locator('input[name="order"]')).toHaveValue('1,2,3,4');
  await expect(trigger).toBeFocused();
});
