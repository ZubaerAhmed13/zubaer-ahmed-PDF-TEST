import { expect, test, type Page } from '@playwright/test';
import { PDFDocument, StandardFonts } from 'pdf-lib';
import { getDocument } from 'pdfjs-dist/legacy/build/pdf.mjs';
import { readFile } from 'node:fs/promises';

const base = '/zubaer-ahmed-PDF-TEST/';
const publicToolIds = [
  'annotate', 'batch', 'compare', 'compress', 'crop', 'edit-pdf', 'extract-images',
  'extract-pages', 'forms', 'images-to-pdf', 'merge', 'metadata', 'metadata-edit',
  'ocr', 'organize', 'page-numbers', 'pdf-to-images', 'preview', 'protect-pdf',
  'redact-secure', 'remove-pages', 'repair-pdf', 'rotate', 'sign-visual', 'split',
  'text-search', 'unlock-pdf', 'watermark', 'workflow',
];

async function source() {
  const doc = await PDFDocument.create();
  const font = await doc.embedFont(StandardFonts.Helvetica);
  for (const [width, label] of [[320, 'First source page'], [480, 'Second source page']] as const) {
    doc.addPage([width, 500]).drawText(label, { x: 40, y: 420, font, size: 16 });
  }
  return { name: 'release-fixture.pdf', mimeType: 'application/pdf', buffer: Buffer.from(await doc.save()) };
}

async function download(page: Page): Promise<Buffer> {
  const pending = page.waitForEvent('download');
  await page.locator('.df2-output').click();
  const path = await (await pending).path();
  if (!path) throw Error('The release did not produce a downloadable file.');
  return readFile(path);
}

async function openResultIn(page: Page, toolId: string): Promise<void> {
  await page.getByText('Use PDF in another tool', { exact: true }).click();
  await page.getByRole('combobox', { name: 'Next tool' }).selectOption(toolId);
  await page.getByRole('button', { name: 'Open selected PDF' }).click();
  await expect(page).toHaveURL(new RegExp('#/tools/' + toolId + '/work$'));
}

test('release identifies its exact build, registers its scoped worker and exposes every public tool route', async ({ page }) => {
  test.setTimeout(90_000);
  await page.goto(base);
  await expect(page.getByRole('heading', { name: /Every document/ })).toBeVisible();
  const expectedBuild = process.env.DOCFLOW_EXPECTED_BUILD || process.env.GITHUB_SHA;
  const expectedVersion = JSON.parse(await readFile('package.json', 'utf8')).version;
  await expect.poll(async () => {
    const response = await page.request.get(base + 'release.json', { headers: { 'Cache-Control': 'no-cache' } });
    if (!response.ok()) return null;
    return response.json();
  }, { timeout: 60_000 }).toMatchObject({
    format: 'docflow-release', schema: 1, version: expectedVersion, build: expectedBuild || expect.stringMatching(/^[a-f0-9]{40}$/),
  });
  const manifest = await page.request.get(base + 'manifest.webmanifest');
  expect(manifest.ok()).toBe(true);
  expect(await manifest.json()).toMatchObject({ start_url: './', scope: './' });
  const registered = await page.waitForFunction(async () => {
    if (!('serviceWorker' in navigator)) return null;
    const registration = await navigator.serviceWorker.ready;
    return registration.active ? { scope: registration.scope, script: registration.active.scriptURL } : null;
  }, undefined, { timeout: 30_000 });
  const worker = await registered.jsonValue();
  expect(worker).toEqual({
    scope: new URL(base, page.url()).href,
    script: new URL(base + 'sw.js', page.url()).href,
  });

  const cards = await page.locator('[data-card-tool]').evaluateAll(nodes =>
    nodes.map(node => ({ id: node.getAttribute('data-card-tool')!, label: node.getAttribute('aria-label')! })));
  const expectedTools = process.env.VITE_DOCFLOW_SERVER_PROCESSING === '1'
    ? [...publicToolIds, 'office-to-pdf'].sort()
    : publicToolIds;
  expect(cards.map(card => card.id).sort()).toEqual(expectedTools);
  for (const { id, label } of cards) {
    await page.goto(base + '#/tools/' + id);
    await expect(page.getByRole('heading', { name: label, level: 1, exact: true })).toBeVisible();
    await expect(page.locator('[data-file-input]')).toBeVisible();
  }
});

test('release runs rotation and AES-256 on the same PDF without sending it over the network', async ({ page }) => {
  await page.goto(base);
  const offOrigin: string[] = [], documentWrites: string[] = [];
  const origin = new URL(page.url()).origin;
  page.on('request', request => {
    const url = new URL(request.url());
    if (!['http:', 'https:'].includes(url.protocol)) return;
    if (url.origin !== origin) offOrigin.push(url.origin);
    if (!['GET', 'HEAD'].includes(request.method())) documentWrites.push(request.method());
  });
  await page.getByRole('searchbox', { name: 'Search PDF tools' }).fill('rotate');
  await page.locator('[data-card-tool=rotate]').click();
  await page.locator('[data-file-input]').setInputFiles(await source());
  await page.getByRole('combobox', { name: 'Rotation' }).selectOption('90');
  await page.locator('[data-run]').click();
  const rotated = await PDFDocument.load(await download(page));
  expect(rotated.getPages().map(p => [p.getWidth(), p.getRotation().angle])).toEqual([[320, 90], [480, 90]]);
  await openResultIn(page, 'protect-pdf');
  const password = 'DocFlow-Synthetic-Release-2026!';
  await page.locator('[name=securityPassword]').fill(password);
  await page.locator('[name=confirmPassword]').fill(password);
  await page.locator('[data-run]').click();
  const secured = await download(page);
  expect(secured.subarray(0, 5).toString()).toBe('%PDF-');
  expect(secured.toString('latin1')).toContain('/Encrypt');
  await expect(PDFDocument.load(secured)).rejects.toThrow();
  await expect(page.getByText('Preview exported PDF', { exact: true })).toHaveCount(0);
  expect(offOrigin).toEqual([]);
  expect(documentWrites).toEqual([]);
});

test('one import can organize, annotate and number, with exact previous and next exports', async ({ page }) => {
  await page.goto(base + '#/tools/organize');
  await page.locator('[data-file-input]').setInputFiles(await source());
  await page.getByRole('button', { name: 'Move page 2 up' }).click();
  await page.locator('[data-run]').click();
  const organized = await download(page);
  await openResultIn(page, 'annotate');
  await page.getByLabel('Note text').fill('Verified note');
  await page.locator('[data-run]').click();
  const annotated = await download(page);
  await openResultIn(page, 'page-numbers');
  await page.getByLabel('Start at').fill('7');
  await page.locator('[data-run]').click();
  const numbered = await download(page);

  const opened = await getDocument({
    data: new Uint8Array(numbered),
    standardFontDataUrl: new URL('../node_modules/pdfjs-dist/standard_fonts/', import.meta.url).pathname,
  }).promise;
  try {
    const expected = ['Second source page', 'First source page'];
    for (const [index, label] of expected.entries()) {
      const result = await opened.getPage(index + 1);
      const text = (await result.getTextContent()).items.map(item => 'str' in item ? item.str : '').join(' ');
      expect(text).toContain(label);
      expect(text).toContain('Verified note');
      expect(text).toContain('Page ' + (index + 7) + ' of 2');
    }
  } finally { await opened.destroy(); }

  const previous = page.getByRole('button', { name: /Previous revision/ });
  const next = page.getByRole('button', { name: /Next revision/ });
  await previous.click();
  await expect(page).toHaveURL(/#\/tools\/annotate\/result$/);
  expect((await download(page)).equals(annotated)).toBe(true);
  await previous.click();
  await expect(page).toHaveURL(/#\/tools\/organize\/result$/);
  expect((await download(page)).equals(organized)).toBe(true);
  await next.click();
  await expect(page).toHaveURL(/#\/tools\/annotate\/result$/);
  await next.click();
  await expect(page).toHaveURL(/#\/tools\/page-numbers\/result$/);
  expect((await download(page)).equals(numbered)).toBe(true);
});

test('crop and metadata changes survive a handoff and reopen with the original page geometry', async ({ page }) => {
  await page.goto(base + '#/tools/crop');
  await page.locator('[data-file-input]').setInputFiles(await source());
  await page.getByLabel('Left margin').fill('30');
  await page.getByLabel('Right margin').fill('20');
  await page.getByLabel('Top margin').fill('40');
  await page.getByLabel('Bottom margin').fill('25');
  await page.locator('[data-run]').click();
  const cropped = await PDFDocument.load(await download(page));
  const cropBox = { x: 30, y: 25, width: 270, height: 435 };
  expect(cropped.getPage(0).getCropBox()).toEqual(cropBox);
  expect(cropped.getPage(0).getMediaBox()).toEqual({ x: 0, y: 0, width: 320, height: 500 });

  await openResultIn(page, 'metadata-edit');
  await page.getByLabel('Title', { exact: true }).fill('Verified release crop');
  await page.getByLabel('Author', { exact: true }).fill('DocFlow test');
  await page.locator('[data-run]').click();
  const updated = await PDFDocument.load(await download(page));
  expect(updated.getTitle()).toBe('Verified release crop');
  expect(updated.getAuthor()).toBe('DocFlow test');
  expect(updated.getPage(0).getCropBox()).toEqual(cropBox);
});
