import {
  PDFDocument,
  PDFDict,
  PDFName,
  PDFHexString,
  PDFString,
  PDFArray,
  degrees,
  rgb,
} from "pdf-lib";
import fontkit from "@pdf-lib/fontkit";
import {
  displaySize,
  pdfBounds,
  toPdf,
  toDisplay,
  type EditPlan,
  type PageFrame,
  type EditObject,
} from "./editModel";
import type { InputFile, OperationResult } from "./types";
import { PdfOperationError } from "./errors";

const name = (value: string): PDFName => PDFName.of(value);
const decode = (value: unknown): string =>
  value instanceof PDFString || value instanceof PDFHexString
    ? value.decodeText()
    : "";
function frameFor(page: ReturnType<PDFDocument["getPage"]>): PageFrame {
  const crop = page.getCropBox(),
    media = page.getMediaBox();
  const x = Math.max(crop.x, media.x),
    y = Math.max(crop.y, media.y);
  return {
    x,
    y,
    width: Math.min(crop.x + crop.width, media.x + media.width) - x,
    height: Math.min(crop.y + crop.height, media.y + media.height) - y,
    rotation: ((page.getRotation().angle % 360) + 360) % 360,
  };
}
function inspectDocument(doc: PDFDocument): {
  frames: PageFrame[];
  objects: EditObject[];
} {
  const objects: EditObject[] = [];
  const frames = doc.getPages().map((page, index) => {
    const frame = frameFor(page);
    const annots = page.node.Annots();
    for (let i = 0; annots && i < annots.size(); i++) {
      const ref = annots.get(i),
        item = doc.context.lookup(ref);
      if (
        !(item instanceof PDFDict) ||
        item.get(name("Subtype"))?.toString() !== "/Text"
      )
        continue;
      const rect = item.lookup(name("Rect"));
      if (!(rect instanceof PDFArray) || rect.size() !== 4) continue;
      const r = rect.asRectangle();
      const a = toDisplay(frame, r.x, r.y),
        b = toDisplay(frame, r.x + r.width, r.y + r.height);
      const size = displaySize(frame);
      if (
        Math.min(a[0], b[0]) < 0 ||
        Math.min(a[1], b[1]) < 0 ||
        Math.max(a[0], b[0]) > size.width ||
        Math.max(a[1], b[1]) > size.height
      )
        continue;
      objects.push({
        id: `existing-${index}-${i}`,
        originalId: `${index}:${ref.toString()}`,
        page: index + 1,
        kind: "comment",
        x: Math.min(a[0], b[0]),
        y: Math.min(a[1], b[1]),
        width: Math.max(18, Math.abs(b[0] - a[0])),
        height: Math.max(18, Math.abs(b[1] - a[1])),
        text: decode(item.get(name("Contents"))),
        color: "#e99b25",
        size: 14,
      });
    }
    return frame;
  });
  return { frames, objects };
}
export async function inspectDirectEdit(
  files: InputFile[],
): Promise<OperationResult> {
  if (!files[0]) throw new Error("Choose a PDF first.");
  const { frames, objects } = inspectDocument(
    await PDFDocument.load(files[0].buffer, { updateMetadata: false }),
  );
  return {
    outputs: [],
    info: { frames: JSON.stringify(frames), comments: JSON.stringify(objects) },
  };
}
export function checkText(text: string, supported?: Set<number>): void {
  // These scripts need shaping/bidi and a wider font suite; never silently substitute.
  if (
    /[\u0590-\u1fff\u200c-\u200f\u202a-\u202e\u2066-\u2069\u2e80-\u9fff\uac00-\ud7af]/u.test(
      text.replace(/[\u1e00-\u1eff]/gu, ""),
    )
  )
    throw new Error(
      "This text needs a script or shaping engine not supported yet. Added text currently supports tested Latin, Greek and Cyrillic characters.",
    );
  if (supported)
    for (const char of text.replace(/[\r\n\t]/g, ""))
      if (!supported.has(char.codePointAt(0)!))
        throw new Error(
          `The embedded font does not contain “${char}”. Choose supported characters.`,
        );
}
async function applyEdits(
  files: InputFile[],
  options: Record<string, unknown>,
): Promise<OperationResult> {
  const doc = await PDFDocument.load(files[0]!.buffer, {
    updateMetadata: false,
  });
  const plan = options.plan as EditPlan;
  if (!plan || !Array.isArray(plan.objects) || plan.objects.length > 1000)
    throw new Error("The edit plan exceeds the 1,000 object limit.");
  let font;
  if (plan.objects.some((o) => o.kind === "text")) {
    if (!files[1])
      throw new Error(
        "The local Unicode font could not be loaded. Retry while online once.",
      );
    doc.registerFontkit(fontkit);
    font = await doc.embedFont(files[1].buffer, { subset: true });
  }
  const supported = font ? new Set(font.getCharacterSet()) : undefined;
  const source = inspectDocument(doc),
    frames = source.frames;
  const originalObjects = new Map(
    source.objects.map((o) => [o.originalId!, o]),
  );
  const unchanged = new Set(
    plan.objects
      .filter(
        (o) =>
          o.originalId &&
          JSON.stringify(o) ===
            JSON.stringify(originalObjects.get(o.originalId)),
      )
      .map((o) => o.originalId!),
  );
  const color = (hex: string) => {
    if (!/^#[0-9a-f]{6}$/i.test(hex)) throw new Error("Invalid object color.");
    return rgb(
      parseInt(hex.slice(1, 3), 16) / 255,
      parseInt(hex.slice(3, 5), 16) / 255,
      parseInt(hex.slice(5, 7), 16) / 255,
    );
  };
  const removed = new Set(plan.removedComments);
  const existing = new Map<string, PDFDict>();
  doc.getPages().forEach((page, index) => {
    const annots = page.node.Annots();
    for (let i = (annots?.size() ?? 0) - 1; i >= 0; i--) {
      const ref = annots!.get(i),
        id = `${index}:${ref.toString()}`,
        item = doc.context.lookup(ref);
      if (!(item instanceof PDFDict)) continue;
      const subtype = item.get(name("Subtype"))?.toString();
      if (
        subtype === "/Popup" &&
        removed.has(`${index}:${item.get(name("Parent"))?.toString()}`)
      ) {
        annots!.remove(i);
        continue;
      }
      if (subtype !== "/Text") continue;
      if (removed.has(id)) annots!.remove(i);
      else existing.set(id, item);
    }
  });
  for (const o of plan.objects) {
    if (o.originalId && unchanged.has(o.originalId)) continue;
    const page = doc.getPage(o.page - 1),
      frame = frames[o.page - 1];
    if (
      !frame ||
      ![o.x, o.y, o.width, o.height, o.size].every(Number.isFinite) ||
      o.width <= 0 ||
      o.height <= 0
    )
      throw new Error("Invalid object geometry.");
    const visible = displaySize(frame);
    if (
      o.x < 0 ||
      o.y < 0 ||
      o.x + o.width > visible.width + 0.01 ||
      o.y + o.height > visible.height + 0.01
    )
      throw new Error("An object is outside the visible page.");
    const [x, y] = toPdf(frame, o.x, o.y + o.height);
    const rotate = degrees(frame.rotation),
      ink = color(o.color);
    if (o.kind === "text") {
      checkText(o.text ?? "", supported);
      if (!font) throw new Error("Font unavailable.");
      const lines = (o.text ?? "").split(/\r?\n/);
      if (
        lines.length * o.size * 1.2 > o.height + 0.1 ||
        lines.some(
          (line) => font.widthOfTextAtSize(line, o.size) > o.width + 0.1,
        )
      )
        throw new Error(
          "Text does not fit its box. Enlarge the box or reduce font size.",
        );
      for (let i = 0; i < lines.length; i++) {
        const p = toPdf(frame, o.x, o.y + o.size + i * o.size * 1.2);
        page.drawText(lines[i]!, {
          x: p[0],
          y: p[1],
          size: o.size,
          font,
          color: ink,
          rotate,
        });
      }
    } else if (o.kind === "image" || o.kind === "signature") {
      if (
        !o.data ||
        o.data.length > 14_000_000 ||
        !/^data:image\/(png|jpeg);base64,/.test(o.data)
      )
        throw new Error("Choose a PNG or JPEG smaller than 10 MB.");
      const image = o.data.startsWith("data:image/png")
        ? await doc.embedPng(o.data)
        : await doc.embedJpg(o.data);
      page.drawImage(image, { x, y, width: o.width, height: o.height, rotate });
    } else if (o.kind === "comment") {
      const box = pdfBounds(frame, o);
      const prior = o.originalId ? existing.get(o.originalId) : undefined;
      if (prior) {
        prior.set(
          name("Rect"),
          doc.context.obj([
            box.x,
            box.y,
            box.x + box.width,
            box.y + box.height,
          ]),
        );
        prior.set(name("Contents"), PDFHexString.fromText(o.text ?? ""));
        prior.set(name("C"), doc.context.obj([ink.red, ink.green, ink.blue]));
        prior.set(
          name("M"),
          PDFString.of(
            `D:${new Date().toISOString().replace(/[-:T]/g, "").slice(0, 14)}Z`,
          ),
        );
        continue;
      }
      const annot = doc.context.obj({
        Type: "Annot",
        Subtype: "Text",
        Rect: [box.x, box.y, box.x + box.width, box.y + box.height],
        Contents: PDFHexString.fromText(o.text ?? ""),
        T: PDFHexString.fromText("DocFlow"),
        NM: PDFHexString.fromText(o.id),
        M: PDFString.of(
          `D:${new Date().toISOString().replace(/[-:T]/g, "").slice(0, 14)}Z`,
        ),
        Name: "Note",
        Open: false,
        C: [ink.red, ink.green, ink.blue],
        F: 4,
        P: page.ref,
      });
      page.node.addAnnot(doc.context.register(annot));
    } else {
      page.drawRectangle({
        x,
        y,
        width: o.width,
        height: o.height,
        rotate,
        color: ink,
        opacity: o.kind === "highlight" ? 0.28 : 1,
        borderColor: ink,
        borderWidth: o.kind === "highlight" ? 0 : 1,
      });
    }
  }
  for (const [pageNumber, rect] of Object.entries(plan.crops)) {
    const frame = frames[Number(pageNumber) - 1];
    if (
      !frame ||
      ![rect.x, rect.y, rect.width, rect.height].every(Number.isFinite)
    )
      throw new Error("Invalid crop.");
    const size = displaySize(frame);
    if (
      rect.x < 0 ||
      rect.y < 0 ||
      rect.width < 8 ||
      rect.height < 8 ||
      rect.x + rect.width > size.width + 0.01 ||
      rect.y + rect.height > size.height + 0.01
    )
      throw new Error("Crop must fit inside the visible page.");
    const r = pdfBounds(frame, rect);
    doc.getPage(Number(pageNumber) - 1).setCropBox(r.x, r.y, r.width, r.height);
  }
  try {
    const bytes = await doc.save();
    return {
      outputs: [
        {
          name: "edited.pdf",
          type: "application/pdf",
          buffer: bytes.slice().buffer,
        },
      ],
    };
  } catch (error) {
    throw new PdfOperationError(
      "EDIT_EXPORT_FAILED",
      error instanceof Error ? error.message : "Unable to export edits.",
    );
  }
}

export async function applyDirectEdit(
  files: InputFile[],
  options: Record<string, unknown>,
): Promise<OperationResult> {
  try {
    return await applyEdits(files, options);
  } catch (error) {
    throw new PdfOperationError(
      "EDIT_EXPORT_FAILED",
      error instanceof Error ? error.message : "Unable to export edits.",
    );
  }
}
