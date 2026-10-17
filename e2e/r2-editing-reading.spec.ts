import { test, expect, type Page } from "@playwright/test";
import AxeBuilder from "@axe-core/playwright";
import {
  PDFDocument,
  PDFName,
  PDFDict,
  PDFHexString,
  PDFString,
  degrees,
} from "pdf-lib";
import { getDocument } from "pdfjs-dist/legacy/build/pdf.mjs";
import { readFile } from "node:fs/promises";
test.use({ actionTimeout: 12_000 });
const path = "/zubaer-ahmed-PDF-TEST/";
async function fixture(readerLinks = false): Promise<Buffer> {
  const doc = await PDFDocument.create();
  for (const rotation of [0, 90, 180, 270]) {
    const p = doc.addPage([460, 620]);
    p.setCropBox(30, 40, 390, 540);
    p.setRotation(degrees(rotation));
    p.drawText("Findable text on page " + doc.getPageCount(), {
      x: 60,
      y: 500,
      size: 14,
    });
  }
  if (readerLinks) {
    const first = doc.getPage(0),
      dest = doc.context.obj([doc.getPage(1).ref, PDFName.of("Fit")]);
    first.node.addAnnot(
      doc.context.register(
        doc.context.obj({
          Type: "Annot",
          Subtype: "Link",
          Rect: [60, 450, 200, 470],
          Border: [0, 0, 0],
          Dest: dest,
        }),
      ),
    );
    first.node.addAnnot(
      doc.context.register(
        doc.context.obj({
          Type: "Annot",
          Subtype: "Link",
          Rect: [60, 420, 200, 440],
          Border: [0, 0, 0],
          A: { S: "URI", URI: PDFString.of("https://example.com/") },
        }),
      ),
    );
    first.node.addAnnot(
      doc.context.register(
        doc.context.obj({
          Type: "Annot",
          Subtype: "Link",
          Rect: [60, 390, 200, 410],
          A: { S: "URI", URI: PDFString.of("javascript:alert(1)") },
        }),
      ),
    );
    const root = doc.context.obj({ Type: "Outlines", Count: 1 }),
      rootRef = doc.context.register(root);
    const itemRef = doc.context.register(
      doc.context.obj({
        Title: PDFHexString.fromText("Section three"),
        Parent: rootRef,
        Dest: [doc.getPage(2).ref, PDFName.of("Fit")],
      }),
    );
    root.set(PDFName.of("First"), itemRef);
    root.set(PDFName.of("Last"), itemRef);
    doc.catalog.set(PDFName.of("Outlines"), rootRef);
  }
  return Buffer.from(await doc.save());
}
async function open(page: Page, id: string, buffer: Buffer): Promise<void> {
  await page.goto(path);
  await page.locator(`#tool-grid [data-open-tool="${id}"]`).click();
  await page
    .locator("#workspace-file")
    .setInputFiles({ name: "r2.pdf", mimeType: "application/pdf", buffer });
  if (id === "preview")
    await page
      .getByRole("button", { name: "Run View PDF", exact: true })
      .click();
}
async function download(page: Page, name: string): Promise<Buffer> {
  const waiting = page.waitForEvent("download");
  await page
    .getByRole("link", { name: new RegExp("^" + name.replace(/\./g, "\\.")) })
    .click();
  const file = await (await waiting).path();
  if (!file) throw Error("No download");
  return readFile(file);
}
async function property(
  page: Page,
  name: string,
  value: string,
): Promise<void> {
  await page.locator(`[data-properties] [name="${name}"]`).fill(value);
}

test("direct editor exports Unicode, draggable shapes, crop and editable comments with command undo", async ({
  page,
}) => {
  test.setTimeout(150_000);
  await open(page, "edit-pdf", await fixture());
  await expect(page.locator("#stage")).toContainText("Editing page 1");
  await page.getByRole("button", { name: "Add text", exact: true }).click();
  await property(page, "text", "Grüße Ελληνικά Привет");
  await property(page, "width", "340");
  await page
    .getByRole("button", { name: "Apply properties", exact: true })
    .click();
  await page.getByRole("button", { name: "Rectangle", exact: true }).click();
  const object = page.locator(".direct-object[data-selected]");
  const box = await object.boundingBox();
  if (!box) throw Error("No object bounds");
  await page.mouse.move(box.x + 20, box.y + 20);
  await page.mouse.down();
  await page.mouse.move(box.x + 60, box.y + 70, { steps: 5 });
  await page.mouse.up();
  expect(Number(await page.locator("[name=x]").inputValue())).toBeGreaterThan(
    36,
  );
  await page.locator(".direct-overlay").focus();
  await page.keyboard.press("Shift+ArrowRight");
  const moved = await page.locator("[name=x]").inputValue();
  await page.getByRole("button", { name: "Undo edit", exact: true }).click();
  await page.getByRole("button", { name: "Redo edit", exact: true }).click();
  await page.locator("[data-objects] button").last().click();
  await expect(page.locator("[name=x]")).toHaveValue(moved);
  await page
    .getByRole("button", { name: "Duplicate selected", exact: true })
    .click();
  await expect(page.locator(".direct-object")).toHaveCount(3);
  await page
    .getByRole("button", { name: "Delete selected", exact: true })
    .click();
  await expect(page.locator(".direct-object")).toHaveCount(2);
  await page.getByRole("button", { name: "Add comment", exact: true }).click();
  await property(page, "text", "Review in another PDF viewer ✓");
  await property(page, "x", "240");
  await property(page, "y", "220");
  await page
    .getByRole("button", { name: "Apply properties", exact: true })
    .click();
  await page.getByRole("button", { name: "Crop page", exact: true }).click();
  await property(page, "x", "10");
  await property(page, "y", "15");
  await property(page, "width", "370");
  await property(page, "height", "510");
  await page
    .getByRole("button", { name: "Apply properties", exact: true })
    .click();
  await page.getByRole("button", { name: "Run Edit PDF", exact: true }).click();
  await expect(page.locator("#stage")).toContainText("Edits ready");
  const bytes = await download(page, "Download edited PDF");
  const doc = await PDFDocument.load(bytes);
  expect(doc.getPage(0).getCropBox()).toEqual({
    x: 40,
    y: 55,
    width: 370,
    height: 510,
  });
  const annots = doc.getPage(0).node.Annots()!;
  const note = doc.context.lookup(annots.get(0), PDFDict);
  expect(
    note.lookup(PDFName.of("Contents"), PDFHexString).decodeText(),
  ).toContain("Review in another");
  const pdf = await getDocument({ data: new Uint8Array(bytes) }).promise;
  expect(
    (await (await pdf.getPage(1)).getTextContent()).items
      .map((i) => ("str" in i ? i.str : ""))
      .join(" "),
  ).toContain("Grüße Ελληνικά Привет");
  await pdf.destroy();
  const axe = await new AxeBuilder({ page })
    .include(".direct-editor")
    .analyze();
  expect(
    axe.violations
      .filter((v) => ["critical", "serious"].includes(v.impact ?? ""))
      .map((v) => v.id),
  ).toEqual([]);
  // A reimport recovers native comments as editable objects, not baked pixels.
  await page.locator("#workspace-file").setInputFiles({
    name: "edited.pdf",
    mimeType: "application/pdf",
    buffer: bytes,
  });
  await expect(page.locator("#stage")).toContainText("Editing page 1");
  await expect(page.locator("[data-objects]")).toContainText(
    "Review in another",
  );
  await page.locator("[data-objects] button").click();
  await property(page, "text", "Revised comment");
  await page
    .getByRole("button", { name: "Apply properties", exact: true })
    .click();
  await page.getByRole("button", { name: "Run Edit PDF", exact: true }).click();
  await expect(page.locator("#stage")).toContainText("Edits ready");
});

test("reader selects text, finds and highlights document matches, jumps and exposes accessible text", async ({
  page,
}) => {
  test.setTimeout(120_000);
  await open(page, "preview", await fixture(true));
  await expect(page.locator("#stage")).toHaveText("Preview ready");
  await page.getByText("Document outline", { exact: true }).click();
  await page
    .getByRole("button", { name: "Section three", exact: true })
    .click();
  await expect(page.locator("#viewer-status")).toContainText("Page 3 of 4");
  await page.getByRole("spinbutton", { name: "Jump to page" }).fill("1");
  await page.getByRole("spinbutton", { name: "Jump to page" }).press("Tab");
  await expect(
    page.getByRole("link", {
      name: "Open link: https://example.com/",
      exact: true,
    }),
  ).toHaveAttribute("rel", "noopener noreferrer");
  await expect(page.locator('.reader-links [href^="javascript:"]')).toHaveCount(
    0,
  );
  await page
    .getByRole("link", { name: "Go to linked page", exact: true })
    .click();
  await expect(page.locator("#viewer-status")).toContainText("Page 2 of 4");
  await page.getByRole("spinbutton", { name: "Jump to page" }).fill("1");
  await page.getByRole("spinbutton", { name: "Jump to page" }).press("Tab");
  const readerScroll = page.locator(".workspace-grid");
  const scrollSize = await readerScroll.evaluate((el) => ({
    full: el.scrollHeight,
    visible: el.clientHeight,
  }));
  if (scrollSize.full > scrollSize.visible + 40) {
    await page.locator(".reader-controls").hover();
    await page.mouse.wheel(0, 250);
    await expect
      .poll(() => readerScroll.evaluate((el) => el.scrollTop))
      .toBeGreaterThan(0);
  }
  await expect(page.locator(".reader-text-layer")).toContainText(
    "Findable text",
  );
  await page
    .getByRole("searchbox", { name: "Search document" })
    .fill("Findable");
  await page.getByRole("button", { name: "Find", exact: true }).click();
  await expect(page.locator("[data-find-status]")).toContainText(
    "Match 1 of 4",
  );
  await expect(page.locator(".reader-text-layer mark")).toHaveCount(1);
  await page.getByRole("button", { name: "Next match", exact: true }).click();
  await expect(page.locator("#viewer-status")).toContainText("Page 2 of 4");
  await expect(page.locator(".reader-text-layer mark")).toHaveCount(1);
  await page.getByRole("spinbutton", { name: "Jump to page" }).fill("4");
  await page.getByRole("spinbutton", { name: "Jump to page" }).press("Tab");
  await expect(page.locator("#viewer-status")).toContainText("Page 4 of 4");
  await page
    .getByRole("button", { name: "Accessible text view", exact: true })
    .click();
  await expect(
    page.getByRole("region", { name: "Selectable page text", exact: true }),
  ).toContainText("Findable text on page 4");
  await page
    .getByRole("combobox", { name: "Reading mode" })
    .selectOption("continuous");
  await expect(page.locator(".reader-adjacent")).toHaveCount(1);
  await expect(
    page.getByRole("button", { name: "Read page 3", exact: true }),
  ).toBeVisible();
  await page.getByRole("button", { name: "Read page 3", exact: true }).click();
  await expect(page.locator("#viewer-status")).toContainText("Page 3 of 4");
  await expect(page.locator(".reader-adjacent")).toHaveCount(2);
  const axe = await new AxeBuilder({ page })
    .include(".reader-controls")
    .analyze();
  expect(
    axe.violations
      .filter((v) => ["critical", "serious"].includes(v.impact ?? ""))
      .map((v) => v.id),
  ).toEqual([]);
});

test("on-page forms sync with the field list, navigate pages, respect read-only and flatten on export", async ({
  page,
}) => {
  test.setTimeout(120_000);
  const doc = await PDFDocument.create(),
    first = doc.addPage([400, 500]),
    second = doc.addPage([400, 500]),
    form = doc.getForm();
  const field = form.createTextField("Name");
  field.addToPage(first, { x: 40, y: 350, width: 210, height: 30 });
  field.enableRequired();
  const locked = form.createTextField("Locked");
  locked.setText("Keep");
  locked.addToPage(first, { x: 40, y: 280, width: 210, height: 30 });
  locked.enableReadOnly();
  const later = form.createTextField("Second");
  later.addToPage(second, { x: 40, y: 350, width: 210, height: 30 });
  const accepted = form.createCheckBox("Accepted");
  accepted.addToPage(second, { x: 40, y: 300, width: 20, height: 20 });
  const preference = form.createDropdown("Preference");
  preference.setOptions(["A", "B"]);
  preference.addToPage(second, { x: 40, y: 250, width: 150, height: 25 });
  const decision = form.createRadioGroup("Decision");
  decision.addOptionToPage("Yes", second, {
    x: 40,
    y: 200,
    width: 20,
    height: 20,
  });
  decision.addOptionToPage("No", second, {
    x: 100,
    y: 200,
    width: 20,
    height: 20,
  });
  const skills = form.createOptionList("Skills");
  skills.setOptions(["One", "Two", "Three"]);
  skills.enableMultiselect();
  skills.addToPage(second, { x: 40, y: 100, width: 180, height: 65 });
  await open(page, "forms", Buffer.from(await doc.save()));
  await expect(
    page.getByRole("textbox", { name: "On page 1: Name", exact: true }),
  ).toBeVisible();
  await page
    .getByRole("textbox", { name: "On page 1: Name", exact: true })
    .fill("Ada");
  await expect(page.locator("#docflow-form-0")).toHaveValue("Ada");
  await expect(
    page.getByRole("textbox", { name: "On page 1: Locked", exact: true }),
  ).toBeDisabled();
  await page.getByRole("button", { name: "Next field", exact: true }).click();
  await page.getByRole("button", { name: "Next field", exact: true }).click();
  await expect(
    page.getByRole("textbox", { name: "On page 2: Second", exact: true }),
  ).toBeFocused();
  await page.keyboard.type("Lovelace");
  await expect(page.locator("#docflow-form-2")).toHaveValue("Lovelace");
  await page
    .getByRole("checkbox", { name: "On page 2: Accepted", exact: true })
    .check();
  await expect(page.locator("#docflow-form-3")).toBeChecked();
  await page
    .getByRole("combobox", { name: "On page 2: Preference", exact: true })
    .selectOption("B");
  await expect(page.locator("#docflow-form-4")).toHaveValue("B");
  await page
    .getByRole("radio", { name: "On page 2: Decision · Yes", exact: true })
    .check();
  await expect(page.locator("#docflow-form-5-0")).toBeChecked();
  await page
    .getByRole("listbox", { name: "On page 2: Skills", exact: true })
    .selectOption(["One", "Two"]);

  await page
    .getByRole("button", { name: "Review flattened appearance", exact: true })
    .click();
  await expect(page.locator("#stage")).toHaveText(
    "Flattened appearance preview ready",
  );
  await expect(page.locator(".form-page-input:visible")).toHaveCount(0);
  await page
    .getByRole("button", { name: "Return to editable fields", exact: true })
    .click();
  await expect(page.locator(".form-page-input:visible")).not.toHaveCount(0);
  await page
    .getByRole("button", { name: "Run Fill PDF forms", exact: true })
    .click();
  await expect(page.locator("#stage")).toHaveText("Complete");
  const bytes = await download(page, "Download filled-form.pdf");
  const reopened = await PDFDocument.load(bytes);
  expect(reopened.getForm().getTextField("Name").getText()).toBe("Ada");
  expect(reopened.getForm().getTextField("Second").getText()).toBe("Lovelace");
  expect(reopened.getForm().getCheckBox("Accepted").isChecked()).toBe(true);
  expect(reopened.getForm().getDropdown("Preference").getSelected()).toEqual([
    "B",
  ]);
  expect(reopened.getForm().getRadioGroup("Decision").getSelected()).toBe(
    "Yes",
  );
  expect(reopened.getForm().getOptionList("Skills").getSelected()).toEqual([
    "One",
    "Two",
  ]);
});

test("direct edits join document revisions and new marks invalidate a stale pending export", async ({
  page,
}) => {
  test.setTimeout(150_000);
  await page.goto(path);
  await page.getByRole("button", { name: "Open a PDF", exact: true }).click();
  await page.locator("#workspace-file").setInputFiles({
    name: "session.pdf",
    mimeType: "application/pdf",
    buffer: await fixture(),
  });
  await expect(page.locator("#stage")).toHaveText("Preview ready");
  await page
    .getByRole("combobox", { name: "Next tool", exact: true })
    .selectOption("edit-pdf");
  await expect(page.locator("#stage")).toContainText("Editing page 1");
  await page.getByRole("button", { name: "Add text", exact: true }).click();
  await property(page, "text", "SESSION Grüße");
  await page
    .getByRole("button", { name: "Apply properties", exact: true })
    .click();
  await page.getByRole("button", { name: "Run Edit PDF", exact: true }).click();
  await expect(
    page.getByRole("button", { name: "Use result", exact: true }),
  ).toBeEnabled();
  await page.getByRole("button", { name: "Add comment", exact: true }).click();
  await expect(
    page.getByRole("button", { name: "Use result", exact: true }),
  ).toHaveCount(0);
  await page.getByRole("button", { name: "Run Edit PDF", exact: true }).click();
  await expect(
    page.getByRole("button", { name: "Use result", exact: true }),
  ).toBeEnabled();
  await page.getByRole("button", { name: "Use result", exact: true }).click();
  await expect(page.locator("#stage")).toContainText("Editing page 1");
  const bytes = await download(page, "Export current PDF");
  const pdf = await getDocument({ data: new Uint8Array(bytes) }).promise;
  const first = await pdf.getPage(1);
  expect(
    (await first.getTextContent()).items
      .map((i) => ("str" in i ? i.str : ""))
      .join(" "),
  ).toContain("SESSION Grüße");
  expect(
    (await first.getAnnotations()).filter((a) => a.subtype === "Text"),
  ).toHaveLength(1);
  await pdf.destroy();
  await page
    .getByRole("button", { name: "Undo revision", exact: true })
    .click();
  const original = await PDFDocument.load(
    await download(page, "Export current PDF"),
  );
  expect(original.getPage(0).node.Annots()?.size() ?? 0).toBe(0);
});
