import { describe, expect, it } from "vitest";
import { PDFDocument, PDFName, PDFArray, degrees } from "pdf-lib";
import { getDocument } from "pdfjs-dist/legacy/build/pdf.mjs";
import { readFile, mkdir, writeFile } from "node:fs/promises";
import { execFileSync } from "node:child_process";
import {
  EditHistory,
  emptyPlan,
  toPdf,
  toDisplay,
  displaySize,
  pdfBounds,
  type PageFrame,
} from "../src/pdf/editModel";
import {
  applyDirectEdit,
  inspectDirectEdit,
  checkText,
} from "../src/pdf/directEdit";
import { fillForms, inspectForms } from "../src/pdf/core";
import type { InputFile } from "../src/pdf/types";
const input = (bytes: Uint8Array): InputFile => ({
  name: "fixture.pdf",
  type: "application/pdf",
  buffer: bytes.slice().buffer as ArrayBuffer,
});
const font = (): Promise<InputFile> =>
  readFile("public/fonts/DocFlowSans.woff").then((b) => ({
    name: "font.ttf",
    type: "font/ttf",
    buffer: b.buffer.slice(
      b.byteOffset,
      b.byteOffset + b.byteLength,
    ) as ArrayBuffer,
  }));

describe("R2 export contracts", () => {
  it("maps screen coordinates exactly like PDF.js for every rotation and an offset CropBox", async () => {
    for (const rotation of [0, 90, 180, 270]) {
      const doc = await PDFDocument.create(),
        page = doc.addPage([500, 700]);
      page.setCropBox(35, 55, 390, 540);
      page.setRotation(degrees(rotation));
      const frame: PageFrame = {
        x: 35,
        y: 55,
        width: 390,
        height: 540,
        rotation,
      };
      const pdf = await getDocument({ data: await doc.save() }).promise;
      try {
        const viewport = (await pdf.getPage(1)).getViewport({ scale: 1 });
        expect(displaySize(frame)).toEqual({
          width: viewport.width,
          height: viewport.height,
        });
        for (const [x, y] of [
          [0, 0],
          [75, 95],
          [190, 330],
        ]) {
          const p = toPdf(frame, x!, y!);
          expect(p).toEqual(viewport.convertToPdfPoint(x!, y!));
          expect(toDisplay(frame, ...p)).toEqual([x, y]);
        }
        expect(
          pdfBounds(frame, { x: 20, y: 30, width: 150, height: 210 }).width,
        ).toBe(rotation % 180 ? 210 : 150);
      } finally {
        await pdf.destroy();
      }
    }
  });
  it("exports Unicode, images, shape placement and crop boxes; reopens/edit-saves native notes in MuPDF", async () => {
    const source = await PDFDocument.create();
    for (const angle of [0, 90, 180, 270]) {
      const page = source.addPage([500, 700]);
      page.setCropBox(35, 55, 390, 540);
      page.setRotation(degrees(angle));
      page.drawText("ORIGINAL", { x: 90, y: 500 });
    }
    const bytes = await source.save(),
      plan = emptyPlan();
    for (let page = 1; page <= 4; page++) {
      plan.objects.push({
        id: `shape-${page}`,
        page,
        kind: "rectangle",
        x: 40,
        y: 65,
        width: 55,
        height: 35,
        color: "#ff0000",
        size: 14,
      });
      plan.objects.push({
        id: `text-${page}`,
        page,
        kind: "text",
        x: 30,
        y: 120,
        width: 300,
        height: 45,
        color: "#203047",
        size: 16,
        text: "Grüße Ελληνικά Привет",
      });
      plan.objects.push({
        id: `note-${page}`,
        page,
        kind: "comment",
        x: 130,
        y: 50,
        width: 24,
        height: 24,
        color: "#e99b25",
        size: 14,
        text: "Editable native comment ✓",
      });
      plan.objects.push({
        id: `image-${page}`,
        page,
        kind: "image",
        x: 200,
        y: 55,
        width: 30,
        height: 30,
        color: "#203047",
        size: 14,
        data: "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aVVYAAAAASUVORK5CYII=",
      });
    }
    const result = await applyDirectEdit([input(bytes), await font()], {
      plan,
    });
    const output = new Uint8Array(result.outputs[0]!.buffer),
      parsed = await getDocument({ data: output.slice() }).promise;
    try {
      for (let p = 1; p <= 4; p++) {
        const page = await parsed.getPage(p);
        const text = (await page.getTextContent()).items
          .map((i) => ("str" in i ? i.str : ""))
          .join(" ");
        expect(text).toContain("Grüße Ελληνικά Привет");
        const notes = (await page.getAnnotations()).filter(
          (a) => a.subtype === "Text",
        );
        expect(notes).toHaveLength(1);
        expect(notes[0]!.contentsObj.str).toContain("Editable native comment");
      }
    } finally {
      await parsed.destroy();
    }
    const inspected = await inspectDirectEdit([input(output)]);
    const comments = JSON.parse(String(inspected.info!.comments));
    expect(comments).toHaveLength(4);
    const changed = emptyPlan();
    changed.objects = [{ ...comments[0], text: "Updated inside DocFlow" }];
    changed.removedComments = [comments[1].originalId];
    const revised = await applyDirectEdit([input(output)], { plan: changed });
    const revisedDoc = await PDFDocument.load(revised.outputs[0]!.buffer);
    expect(revisedDoc.getPage(1).node.Annots()?.size()).toBe(0);
    expect(revisedDoc.getPage(2).node.Annots()?.size()).toBe(1);
    const cropped = emptyPlan();
    cropped.crops = {
      "1": { x: 20, y: 30, width: 150, height: 210 },
      "2": { x: 20, y: 30, width: 150, height: 210 },
      "3": { x: 20, y: 30, width: 150, height: 210 },
      "4": { x: 20, y: 30, width: 150, height: 210 },
    };
    const crop = await applyDirectEdit([input(bytes)], { plan: cropped });
    const cropDoc = await PDFDocument.load(crop.outputs[0]!.buffer);
    for (let i = 0; i < 4; i++) {
      const frame = { x: 35, y: 55, width: 390, height: 540, rotation: i * 90 };
      expect(cropDoc.getPage(i).getCropBox()).toEqual(
        pdfBounds(frame, cropped.crops[String(i + 1)]!),
      );
    }
    await mkdir("artifacts/r2", { recursive: true });
    await writeFile("artifacts/r2/geometry-comments-unicode.pdf", output);
    await writeFile(
      "artifacts/r2/cropped.pdf",
      new Uint8Array(crop.outputs[0]!.buffer),
    );
    const evidence = execFileSync("python", ["scripts/verify-r2-pdf.py"], {
      encoding: "utf8",
    });
    expect(JSON.parse(evidence).comment_edit_reopen).toBe(true);
    await writeFile("artifacts/r2/independent-verification.json", evidence);
  });
  it("preserves field metadata, required validation, read-only values and flatten appearances", async () => {
    const doc = await PDFDocument.create(),
      page = doc.addPage([350, 450]),
      form = doc.getForm();
    const name = form.createTextField("Name");
    name.addToPage(page, { x: 40, y: 300, width: 200, height: 30 });
    name.enableRequired();
    const locked = form.createTextField("Locked");
    locked.setText("Original");
    locked.addToPage(page, { x: 40, y: 240, width: 200, height: 30 });
    locked.enableReadOnly();
    const bytes = await doc.save(),
      fields = JSON.parse(
        String((await inspectForms([input(bytes)], {}, () => {})).info!.fields),
      );
    expect(fields[0]).toMatchObject({
      name: "Name",
      required: true,
      readOnly: false,
      widgets: [
        { page: 1, rect: { x: 39.5, y: 299.5, width: 201, height: 31 } },
      ],
    });
    await expect(
      fillForms([input(bytes)], { values: '{"Name":""}' }, () => {}),
    ).rejects.toThrow("required field");
    const result = await fillForms(
        [input(bytes)],
        { values: '{"Name":"Ada","Locked":"Changed"}' },
        () => {},
      ),
      reopened = await PDFDocument.load(result.outputs[0]!.buffer);
    expect(reopened.getForm().getTextField("Name").getText()).toBe("Ada");
    expect(reopened.getForm().getTextField("Locked").getText()).toBe(
      "Original",
    );
    const flat = await fillForms(
        [input(bytes)],
        { values: '{"Name":"Ada"}', flatten: true },
        () => {},
      ),
      flatDoc = await PDFDocument.load(flat.outputs[0]!.buffer);
    expect(flatDoc.getForm().getFields()).toHaveLength(0);
    expect(
      flatDoc.getPage(0).node.lookup(PDFName.of("Contents"), PDFArray).size(),
    ).toBeGreaterThan(0);
    await writeFile(
      "artifacts/r2/filled-form.pdf",
      new Uint8Array(result.outputs[0]!.buffer),
    );
    await writeFile(
      "artifacts/r2/flat-form.pdf",
      new Uint8Array(flat.outputs[0]!.buffer),
    );
    expect(
      execFileSync("python", ["scripts/verify-r2-pdf.py", "forms"], {
        encoding: "utf8",
      }),
    ).toContain("true");
  });
  it("rejects unsupported shaping, missing glyphs, invalid geometry and preserves bounded command history", async () => {
    expect(() => checkText("مرحبا")).toThrow("shaping");
    expect(() => checkText("বাংলা")).toThrow("shaping");
    expect(() => checkText("😀", new Set([65]))).toThrow("does not contain");
    expect(() => checkText("Grüße Ελληνικά Привет")).not.toThrow();
    const history = new EditHistory();
    const plan = emptyPlan();
    plan.crops["1"] = { x: 10, y: 20, width: 30, height: 40 };
    history.commit(plan);
    plan.crops["1"]!.x = 99;
    expect(history.current.crops["1"]!.x).toBe(10);
    expect(history.undo()).toEqual(emptyPlan());
    expect(history.redo().crops["1"]!.x).toBe(10);
    history.undo();
    history.commit({ ...emptyPlan(), removedComments: ["a"] });
    expect(history.canRedo).toBe(false);
    const doc = await PDFDocument.create();
    doc.addPage([200, 200]);
    const invalid = emptyPlan();
    invalid.objects.push({
      id: "a",
      page: 1,
      kind: "rectangle",
      x: 190,
      y: 0,
      width: 40,
      height: 30,
      color: "#ff0000",
      size: 14,
    });
    await expect(
      applyDirectEdit([input(await doc.save())], { plan: invalid }),
    ).rejects.toThrow("outside");
  });
});
