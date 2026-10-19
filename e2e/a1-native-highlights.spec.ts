import { returnToEditor } from './helpers/editorReturn';
import { test, expect, type Page } from '@playwright/test';
import AxeBuilder from '@axe-core/playwright';
import { PDFDocument, PDFName, PDFString, PDFDict, degrees } from 'pdf-lib';
import { readFile } from 'node:fs/promises';
async function fixture(unsupported = false): Promise<Buffer> {
    const doc = await PDFDocument.create(), p = doc.addPage([400, 500]);
    p.setCropBox(30, 40, 330, 430);
    p.setRotation(degrees(90));
    p.drawText('ORIGINAL searchable text', { x: 80, y: 360, size: 12 });
    if (unsupported)
        p.node.addAnnot(doc.context.register(doc.context.obj({ Type: 'Annot', Subtype: 'Highlight', Rect: [60, 200, 180, 250], QuadPoints: [60, 250, 180, 250, 60, 230, 180, 230, 60, 220, 180, 220, 60, 200, 180, 200], C: [1, 1, 0], Contents: PDFString.of('Two-line external highlight') })));
    return Buffer.from(await doc.save());
}
async function load(page: Page, buffer: Buffer): Promise<void> {
    await page.locator('#workspace-file').setInputFiles({ name: 'synthetic-review.pdf', mimeType: 'application/pdf', buffer });
    await expect(page.locator('#stage')).toContainText('Editing page 1');
}
async function open(page: Page, buffer: Buffer): Promise<void> {
    await page.goto('/zubaer-ahmed-PDF-TEST/');
    await page.locator('#tool-grid [data-open-tool="edit-pdf"]').click();
    await load(page, buffer);
}
async function properties(page: Page, values: Record<string, string>): Promise<void> {
    for (const [name, value] of Object.entries(values))
        await page.locator(`[data-properties] [name="${name}"]`).fill(value);
    await page.getByRole('button', { name: 'Apply properties', exact: true }).click();
}
async function output(page: Page): Promise<Buffer> {
  await returnToEditor(page);
    await page.getByRole('button', { name: 'Run Edit PDF', exact: true }).click();
    await expect(page.locator('[data-result-page]')).toBeVisible();
    await returnToEditor(page);
    const pending = page.waitForEvent('download');
    await page.getByRole('link', { name: 'Download edited PDF', exact: true }).click();
    const path = await (await pending).path();
    if (!path)
        throw Error('Download missing');
    return readFile(path);
}
async function annotations(buffer: Buffer): Promise<PDFDict[]> {
    const doc = await PDFDocument.load(buffer), annots = doc.getPage(0).node.Annots();
    return (annots?.asArray() ?? []).map(ref => doc.context.lookup(ref, PDFDict)).filter(d => d.get(PDFName.of('Subtype'))?.toString() === '/Highlight');
}
test('native region highlights reopen for property edits, duplication, undo and deletion without stale canvas marks', async ({ page }) => {
    test.setTimeout(120000);
    const writes: string[] = [];
    page.on('request', r => {
        if (!['GET', 'HEAD'].includes(r.method()))
            writes.push(r.url());
    });
    await open(page, await fixture());
    await page.getByRole('button', { name: 'Editable highlight', exact: true }).click();
    await properties(page, { text: 'Review this region', x: '40', y: '65', width: '100', height: '35' });
    const first = await output(page);
    expect(await annotations(first)).toHaveLength(1);
    await load(page, first);
    await expect(page.locator('[data-objects]')).toContainText('editable highlight');
    const pixel = await page.locator('.direct-page canvas').evaluate((canvas: HTMLCanvasElement) => {
        const context = canvas.getContext('2d')!;
        return Array.from(context.getImageData(Math.round(60 * canvas.width / 430), Math.round(80 * canvas.height / 330), 1, 1).data);
    });
    expect(pixel.slice(0, 3)).toEqual([255, 255, 255]);
    await page.locator('[data-objects] button').click();
    await page.getByRole('button', { name: 'Duplicate selected', exact: true }).click();
    await expect(page.locator('.direct-object')).toHaveCount(2);
    await page.getByRole('button', { name: 'Undo edit', exact: true }).click();
    await expect(page.locator('.direct-object')).toHaveCount(1);
    await page.locator('[data-objects] button').click();
    await properties(page, { text: 'Revised review ✓', x: '80', y: '110', color: '#33cc66' });
    const revised = await output(page), marks = await annotations(revised);
    expect(marks).toHaveLength(1);
    expect(marks[0]!.lookup(PDFName.of('Contents')).toString()).not.toBe((await annotations(first))[0]!.lookup(PDFName.of('Contents')).toString());
    await load(page, revised);
    await page.locator('[data-objects] button').click();
    await expect(page.locator('[name=x]')).toHaveValue('80');
    await expect(page.locator('[name=y]')).toHaveValue('110');
    await page.getByRole('button', { name: 'Delete selected', exact: true }).click();
    await expect(page.locator('.direct-object')).toHaveCount(0);
    await page.getByRole('button', { name: 'Undo edit', exact: true }).click();
    await expect(page.locator('.direct-object')).toHaveCount(1);
    await page.getByRole('button', { name: 'Redo edit', exact: true }).click();
    await expect(page.locator('.direct-object')).toHaveCount(0);
    expect(await annotations(await output(page))).toHaveLength(0);
    const axe = await new AxeBuilder({ page }).include('#workspace').analyze();
    expect(axe.violations.filter(v => ['serious', 'critical'].includes(v.impact ?? '')).map(v => v.id)).toEqual([]);
    expect(writes).toEqual([]);
});
test('multi-region highlights are disclosed and retained unchanged on mobile export', async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    const source = await fixture(true);
    await open(page, source);
    await expect(page.locator('[data-highlight-notice]')).toContainText('1 existing highlight');
    await expect(page.locator('.direct-object')).toHaveCount(0);
    await expect(page.locator('[data-highlight-notice]')).toContainText('kept unchanged');
    const out = await output(page), before = await annotations(source), after = await annotations(out);
    expect(after).toHaveLength(1);
    expect(after[0]!.toString()).toBe(before[0]!.toString());
    expect(await page.locator('[data-direct-editor]').evaluate(el => el.scrollWidth <= el.clientWidth + 1)).toBe(true);
});
test('custom page scale fails clearly and removes stale marks and downloads before a fresh import', async ({ page }) => {
    await open(page, await fixture());
    await page.getByRole('button', { name: 'Editable highlight', exact: true }).click();
    const bytes = await output(page), doc = await PDFDocument.load(bytes);
    doc.getPage(0).node.set(PDFName.of('UserUnit'), doc.context.obj(2));
    await page.locator('#workspace-file').setInputFiles({ name: 'custom-scale.pdf', mimeType: 'application/pdf', buffer: Buffer.from(await doc.save()) });
    await expect(page.locator('#error')).toContainText('custom page scale');
    await expect(page.locator('#run-operation')).toBeDisabled();
    await expect(page.locator('.direct-object')).toHaveCount(0);
    await expect(page.getByRole('link', { name: 'Download edited PDF', exact: true })).toHaveCount(0);
    await load(page, await fixture());
    await expect(page.locator('#error')).toBeHidden();
    await page.getByRole('button', { name: 'Editable highlight', exact: true }).click();
    expect(await annotations(await output(page))).toHaveLength(1);
});
