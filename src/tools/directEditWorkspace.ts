import "../styles/direct-edit.css";
import { addShareButton } from "../app/fileExport";
import { workspaceRuntime } from "../app/workspaceRuntime";
import { mountSignaturePad } from "../app/signaturePad";
import { createPreview, type PreviewController } from "../pdf/render";
import { runWorkerOperation, type RunningOperation } from "../pdf/workerClient";
import {
  EditHistory,
  emptyPlan,
  constrain,
  displaySize,
  type EditObject,
  type PageFrame,
  type Rect,
} from "../pdf/editModel";
import type { ToolDefinition } from "./registry";

export function mountWorkspace(
  root: HTMLDivElement,
  _tool: ToolDefinition,
): void {
  const runtime = workspaceRuntime(root),
    events = new AbortController(),
    signal = events.signal;
  root.innerHTML = `<section class="direct-editor" data-direct-editor><header><h2>Edit PDF</h2><p>Add text, images, shapes, visual signatures and editable region highlights and sticky-note comments. Original page text stays unchanged. All work stays in this tab.</p><label>Source PDF<input id="workspace-file" aria-label="Source files" type="file" accept="application/pdf,.pdf"></label><div data-document-invitation-slot></div></header>
  <div class="direct-toolbar" aria-label="Editor tools"><button data-add="text">Add text</button><button data-add="rectangle">Rectangle</button><button data-add="highlight">Highlight region</button><button data-add="native-highlight">Editable highlight</button><label class="direct-image-label">Add image<input data-image type="file" accept="image/png,image/jpeg"></label><button data-sign>Visual signature</button><button data-add="comment">Add comment</button><button data-crop>Crop page</button><button data-undo>Undo edit</button><button data-redo>Redo edit</button><label><input data-snap type="checkbox" checked> Snap to page</label></div>
  <p data-highlight-help>Editable highlights are review marks with comments. Reopen them to move, resize, recolor or delete. Highlight region stays baked in. Neither removes original content.</p><p data-highlight-notice role="status" hidden></p>
  <div class="direct-navigation"><button data-prev>Previous page</button><label>Page<input data-page type="number" value="1" min="1"></label><span data-count></span><button data-next>Next page</button><label>Zoom<select data-zoom><option value="fit">Fit width</option><option value="0.75">75%</option><option value="1">100%</option><option value="1.5">150%</option><option value="2">200%</option></select></label></div>
  <div class="direct-pan-controls"><button type="button" data-select-mode aria-pressed="true">Select objects</button><button type="button" data-pan-mode aria-pressed="false">Pan page</button><button type="button" data-properties-toggle>Object properties</button></div><p class="direct-pan-help" data-pan-help>Select objects to edit. Use Pan page for touch scrolling and browser pinch zoom. Properties and move buttons work without dragging.</p><div class="direct-layout"><div class="direct-scroll" role="region" tabindex="0" aria-label="Editable PDF page"><div class="direct-page"><canvas></canvas><div class="direct-overlay" aria-label="Added content"></div></div></div><details class="direct-inspector" open><summary>Objects and comments</summary><p>Shift-click to select several objects. Drag to move; use the corner handle to resize. Arrow keys nudge by 1 point, Shift by 10. Delete removes selected objects.</p><div data-objects></div><form data-properties><label>Content<textarea name="text" rows="3"></textarea></label><div class="direct-numbers">${["x", "y", "width", "height", "size"].map((n) => `<label>${n === "size" ? "Font size" : n[0]!.toUpperCase() + n.slice(1)}<input type="number" step="0.5" name="${n}" min="${["x", "y"].includes(n) ? 0 : 1}"></label>`).join("")}</div><label>Color<input name="color" type="color" value="#203047"></label><button type="submit">Apply properties</button></form><div class="direct-nudge" aria-label="Move selected objects"><button type="button" data-nudge="left">Move left</button><button type="button" data-nudge="right">Move right</button><button type="button" data-nudge="up">Move up</button><button type="button" data-nudge="down">Move down</button></div><div class="direct-toolbar"><button data-duplicate>Duplicate selected</button><button data-delete>Delete selected</button><button data-align="left">Align left</button><button data-align="center">Align centers</button><button data-align="top">Align top</button></div><label>Copy selected to pages<input data-copy-pages placeholder="2,3,4"></label><button data-copy>Copy to pages</button><button data-clear-crop>Reset crop</button><p data-crop-help hidden>Crop hides content; it does not securely remove it. Drag the crop frame or its four corners, or edit X, Y, Width and Height above.</p></details></div>
  <section data-sign-panel hidden><h3>Visual signature</h3><div data-sign-pad></div><label>Or type a signature<input data-sign-name></label><button data-sign-add>Add signature to page</button><button data-sign-close>Close signature panel</button><p>This is a visible mark, not a cryptographic signature.</p></section><p id="stage" role="status" aria-live="polite">Choose a PDF to begin.</p><p id="error" role="alert" hidden></p><div class="direct-export-actions"><button id="cancel-operation" disabled>Cancel</button><button id="run-operation" class="primary" disabled>Run Edit PDF</button></div><div data-download></div></section>`;
  const q = <T extends Element = HTMLElement>(selector: string): T =>
    root.querySelector<T>(selector)!;
  const canvas = q<HTMLCanvasElement>("canvas"),
    overlay = q(".direct-overlay"),
    pageHost = q(".direct-page");
  const form = q<HTMLFormElement>("[data-properties]"),
    stage = q("#stage"),
    error = q("#error");
  let source: File | null = null,
    viewer: PreviewController | null = null,
    frames: PageFrame[] = [],
    currentPage = 1,
    scale = 1;
  let history = new EditHistory(),
    plan = history.current,
    selected = new Set<string>(),
    cropMode = false;
  let panMode = false;
  let generation = 0,
    disposed = false,
    running: RunningOperation | null = null,
    busy = false,
    urls: string[] = [];
  const pad = mountSignaturePad(q("[data-sign-pad]"));
  const listen = (selector: string, handler: () => void): void =>
    q(selector).addEventListener("click", handler, { signal });
  const failure = (e: unknown): void => {
    if (!disposed) {
      error.hidden = false;
      error.textContent = e instanceof Error ? e.message : String(e);
    }
  };
  const commit = (): void => {
    try {
      if (history.commit(plan)) {
        runtime.changed?.();
        q("[data-download]").replaceChildren();
      }
    } catch (e) {
      plan = history.current;
      failure(e);
    }
    draw();
  };
  const activeFrame = (): PageFrame | undefined => frames[currentPage - 1];
  const chosen = (): EditObject[] =>
    plan.objects.filter((o) => selected.has(o.id));
  const objectLabel = (o: EditObject): string => o.kind === "native-highlight" ? "editable highlight" : o.kind;
  function properties(): void {
    const object = cropMode ? plan.crops[String(currentPage)] : chosen()[0];
    for (const input of form.querySelectorAll<
      HTMLInputElement | HTMLTextAreaElement
    >("input,textarea")) {
      input.disabled =
        !object || (cropMode && ["text", "size", "color"].includes(input.name)) || (!cropMode && chosen()[0]?.kind === "native-highlight" && input.name === "size");
      input.value = object
        ? String(
            (object as unknown as Record<string, unknown>)[input.name] ??
              (input.name === "color" ? "#203047" : ""),
          )
        : "";
    }
    q<HTMLButtonElement>("[data-undo]").disabled = !history.canUndo || busy;
    q<HTMLButtonElement>("[data-redo]").disabled = !history.canRedo || busy;
    q("[data-crop-help]").hidden = !cropMode;
  }
  function draw(): void {
    const hadFocus = overlay.contains(document.activeElement);
    overlay.replaceChildren();
    if (hadFocus) overlay.focus();
    const frame = activeFrame();
    if (!frame) return;
    const size = displaySize(frame);
    pageHost.style.width = `${size.width * scale}px`;
    pageHost.style.height = `${size.height * scale}px`;
    for (const o of plan.objects.filter((o) => o.page === currentPage)) {
      const button = document.createElement("div");
      button.className = "direct-object";
      button.dataset.object = o.id;
      button.tabIndex = 0;
      button.setAttribute("role", "button");
      button.setAttribute(
        "aria-label",
        `${objectLabel(o)}: ${o.text || "added content"}`,
      );
      button.setAttribute("aria-pressed", String(selected.has(o.id)));
      Object.assign(button.style, {
        left: `${o.x * scale}px`,
        top: `${o.y * scale}px`,
        width: `${o.width * scale}px`,
        height: `${o.height * scale}px`,
        fontSize: `${o.size * scale}px`,
        color: o.color,
      });
      if (o.kind === "image" || o.kind === "signature") {
        const image = document.createElement("img");
        image.src = o.data ?? "";
        image.alt = o.kind;
        image.draggable = false;
        button.append(image);
      } else if (o.kind === "native-highlight") {
        button.style.background = `${o.color}${Math.round((o.opacity ?? 0.28) * 255).toString(16).padStart(2, "0")}`;
        button.style.mixBlendMode = "multiply";
      } else if (o.kind === "rectangle" || o.kind === "highlight") {
        button.style.background = o.color;
        button.style.opacity = o.kind === "highlight" ? "0.28" : "1";
      } else button.textContent = o.kind === "comment" ? "▣" : (o.text ?? "");
      if (selected.has(o.id)) button.dataset.selected = "true";
      const handle = document.createElement("span");
      handle.dataset.resize = "se";
      handle.className = "direct-handle";
      handle.setAttribute("aria-hidden", "true");
      button.append(handle);
      overlay.append(button);
    }
    const crop = plan.crops[String(currentPage)];
    if (crop) {
      const box = document.createElement("div");
      box.className = "direct-crop";
      box.dataset.cropBox = "true";
      box.style.pointerEvents = cropMode ? "auto" : "none";
      Object.assign(box.style, {
        left: `${crop.x * scale}px`,
        top: `${crop.y * scale}px`,
        width: `${crop.width * scale}px`,
        height: `${crop.height * scale}px`,
      });
      for (const corner of ["nw", "ne", "sw", "se"]) {
        const handle = document.createElement("span");
        handle.className = `direct-handle ${corner}`;
        handle.dataset.resize = corner;
        box.append(handle);
      }
      overlay.append(box);
    }
    const list = q("[data-objects]");
    list.replaceChildren();
    for (const o of plan.objects) {
      const b = document.createElement("button");
      b.type = "button";
      b.textContent = `Page ${o.page} · ${objectLabel(o)} · ${(o.text || objectLabel(o)).slice(0, 50)}`;
      b.setAttribute("aria-pressed", String(selected.has(o.id)));
      b.addEventListener("click", () => {
        cropMode = false;
        selected = new Set([o.id]);
        void show(o.page);
      });
      list.append(b);
    }
    properties();
  }
  async function show(number: number): Promise<void> {
    if (!viewer || busy) return;
    currentPage = Math.max(1, Math.min(frames.length, number));
    const frame = activeFrame()!;
    const fit = q<HTMLSelectElement>("[data-zoom]").value;
    scale =
      fit === "fit"
        ? Math.max(
            0.2,
            Math.min(
              1.5,
              (q(".direct-scroll").clientWidth - 36) / displaySize(frame).width,
            ),
          )
        : Number(fit);
    q<HTMLInputElement>("[data-page]").value = String(currentPage);
    q("[data-count]").textContent = `of ${frames.length}`;
    await viewer.render(currentPage, scale);
    if (!disposed) {
      draw();
      stage.textContent = `Editing page ${currentPage} of ${frames.length}`;
    }
  }
  function add(kind: EditObject["kind"], data?: string, text?: string): void {
    const frame = activeFrame();
    if (!frame || busy) return;
    if (plan.objects.length >= 1000) {
      failure("A document can contain up to 1,000 added objects.");
      return;
    }
    cropMode = false;
    const object: EditObject = {
      id: crypto.randomUUID(),
      page: currentPage,
      kind,
      ...constrain(
        {
          x: 36,
          y: 36,
          width: kind === "comment" ? 24 : 180,
          height: kind === "comment" ? 24 : kind === "text" ? 60 : 70,
        },
        frame,
      ),
      text:
        text ??
        (kind === "text"
          ? "Your text"
          : kind === "comment"
            ? "Your comment"
            : ""),
      color: kind === "highlight" || kind === "native-highlight" ? "#ffcf33" : "#203047",
      ...(kind === "native-highlight" ? { opacity: 0.28 } : {}),
      size: 16,
      data,
    };
    plan.objects.push(object);
    selected = new Set([object.id]);
    commit();
    q<HTMLTextAreaElement>("textarea[name=text]").focus();
  }
  root
    .querySelectorAll<HTMLElement>("[data-add]")
    .forEach((button) =>
      button.addEventListener(
        "click",
        () => add(button.dataset.add as EditObject["kind"]),
        { signal },
      ),
    );
  q<HTMLInputElement>("[data-image]").addEventListener(
    "change",
    async (e) => {
      const input = e.target as HTMLInputElement,
        file = input.files?.[0];
      input.value = "";
      if (!file) return;
      if (
        file.size > 10 * 1024 * 1024 ||
        !["image/png", "image/jpeg"].includes(file.type)
      ) {
        failure("Choose a PNG or JPEG smaller than 10 MB.");
        return;
      }
      const reader = new FileReader(),
        ticket = generation;
      reader.onload = () => {
        if (
          !disposed &&
          ticket === generation &&
          typeof reader.result === "string"
        )
          add("image", reader.result);
      };
      reader.readAsDataURL(file);
    },
    { signal },
  );
  listen("[data-sign]", () => {
    q("[data-sign-panel]").hidden = false;
  });
  listen("[data-sign-close]", () => {
    q("[data-sign-panel]").hidden = true;
  });
  listen("[data-sign-add]", () => {
    const data = pad.getData();
    if (data) add("signature", data);
    else {
      const text = q<HTMLInputElement>("[data-sign-name]").value.trim();
      if (!text) {
        failure("Draw or type your signature first.");
        return;
      }
      add("text", undefined, text);
    }
    q("[data-sign-panel]").hidden = true;
  });
  listen("[data-crop]", () => {
    const frame = activeFrame();
    if (!frame) return;
    cropMode = true;
    selected.clear();
    if (!plan.crops[String(currentPage)])
      plan.crops[String(currentPage)] = { x: 0, y: 0, ...displaySize(frame) };
    commit();
  });
  listen("[data-clear-crop]", () => {
    delete plan.crops[String(currentPage)];
    cropMode = false;
    commit();
  });
  listen("[data-undo]", () => {
    plan = history.undo();
    selected.clear();
    cropMode = false;
    runtime.changed?.();
    draw();
  });
  listen("[data-redo]", () => {
    plan = history.redo();
    selected.clear();
    cropMode = false;
    runtime.changed?.();
    draw();
  });
  function remove(): void {
    for (const o of chosen())
      if (o.originalId) plan.removedComments.push(o.originalId);
    plan.objects = plan.objects.filter((o) => !selected.has(o.id));
    selected.clear();
    commit();
  }
  listen("[data-delete]", remove);
  listen("[data-duplicate]", () => {
    const copies = chosen().map((o) => ({
      ...o,
      id: crypto.randomUUID(),
      originalId: undefined,
      ...constrain({ ...o, x: o.x + 12, y: o.y + 12 }, frames[o.page - 1]!),
    }));
    if (plan.objects.length + copies.length > 1000) return;
    plan.objects.push(...copies);
    selected = new Set(copies.map((o) => o.id));
    commit();
  });
  root.querySelectorAll<HTMLElement>("[data-align]").forEach((button) =>
    button.addEventListener(
      "click",
      () => {
        const objects = chosen().filter((o) => o.page === currentPage);
        if (objects.length < 2) return;
        const first = objects[0]!;
        for (const o of objects.slice(1)) {
          if (button.dataset.align === "top") o.y = first.y;
          else
            o.x =
              button.dataset.align === "left"
                ? first.x
                : first.x + (first.width - o.width) / 2;
          Object.assign(o, constrain(o, activeFrame()!));
        }
        commit();
      },
      { signal },
    ),
  );
  listen("[data-copy]", () => {
    const pages = q<HTMLInputElement>("[data-copy-pages]")
      .value.split(",")
      .map(Number);
    if (
      !pages.length ||
      pages.some((p) => !Number.isInteger(p) || p < 1 || p > frames.length)
    ) {
      failure("Enter valid page numbers separated by commas.");
      return;
    }
    const objects = chosen();
    if (plan.objects.length + pages.length * objects.length > 1000) return;
    for (const page of new Set(pages))
      for (const o of objects)
        plan.objects.push({
          ...o,
          id: crypto.randomUUID(),
          originalId: undefined,
          page,
          ...constrain(o, frames[page - 1]!),
        });
    commit();
  });
  form.addEventListener(
    "submit",
    (e) => {
      e.preventDefault();
      const frame = activeFrame();
      if (!frame || busy) return;
      const data = new FormData(form);
      const rect = {
        x: Number(data.get("x")),
        y: Number(data.get("y")),
        width: Number(data.get("width")),
        height: Number(data.get("height")),
      };
      if (!Object.values(rect).every(Number.isFinite)) return;
      if (cropMode) plan.crops[String(currentPage)] = constrain(rect, frame);
      else
        for (const o of chosen())
          Object.assign(o, constrain(rect, frames[o.page - 1]!), {
            text: String(data.get("text") ?? ""),
            size: Math.min(200, Math.max(4, Number(data.get("size")) || 16)),
            color: String(data.get("color") ?? "#203047"),
          });
      commit();
    },
    { signal },
  );
  listen("[data-prev]", () => {
    void show(currentPage - 1);
  });
  listen("[data-next]", () => {
    void show(currentPage + 1);
  });
  q("[data-page]").addEventListener(
    "change",
    () => {
      void show(Number(q<HTMLInputElement>("[data-page]").value) || 1);
    },
    { signal },
  );
  q("[data-zoom]").addEventListener(
    "change",
    () => {
      void show(currentPage);
    },
    { signal },
  );
  let drag: {
    x: number;
    y: number;
    objects: { target: Rect; original: Rect }[];
    resize: string;
    pointer: number;
  } | null = null;
  overlay.addEventListener(
    "pointerdown",
    (e) => {
      if (panMode || busy || e.button !== 0) return;
      const target = e.target as Element,
        objectElement = target.closest<HTMLElement>("[data-object]"),
        crop = target.closest("[data-crop-box]");
      if (cropMode && crop) {
        const rect = plan.crops[String(currentPage)]!;
        drag = {
          x: e.clientX,
          y: e.clientY,
          objects: [{ target: rect, original: { ...rect } }],
          resize: (target as HTMLElement).dataset.resize ?? "",
          pointer: e.pointerId,
        };
      } else if (objectElement && !cropMode) {
        const id = objectElement.dataset.object!;
        if (e.shiftKey && selected.has(id)) selected.delete(id);
        else {
          if (!e.shiftKey && !selected.has(id)) selected.clear();
          selected.add(id);
        }
        drag = {
          x: e.clientX,
          y: e.clientY,
          objects: chosen()
            .filter((o) => o.page === currentPage)
            .map((o) => ({ target: o, original: { ...o } })),
          resize: (target as HTMLElement).dataset.resize ?? "",
          pointer: e.pointerId,
        };
      } else {
        selected.clear();
        draw();
        return;
      }
      e.preventDefault();
      overlay.setPointerCapture(e.pointerId);
      overlay.focus();
      draw();
    },
    { signal },
  );
  overlay.tabIndex = 0;
  overlay.setAttribute("role", "group");
  overlay.addEventListener(
    "pointermove",
    (e) => {
      if (!drag || drag.pointer !== e.pointerId) return;
      const dx = (e.clientX - drag.x) / scale,
        dy = (e.clientY - drag.y) / scale;
      for (const { target, original: o } of drag.objects) {
        const r = { ...o };
        if (drag.resize) {
          if (drag.resize.includes("w")) {
            r.x += dx;
            r.width -= dx;
          } else r.width += dx;
          if (drag.resize.includes("n")) {
            r.y += dy;
            r.height -= dy;
          } else r.height += dy;
        } else {
          r.x += dx;
          r.y += dy;
        }
        Object.assign(
          target,
          constrain(
            r,
            activeFrame()!,
            q<HTMLInputElement>("[data-snap]").checked,
          ),
        );
      }
      draw();
    },
    { signal },
  );
  const endDrag = (): void => {
    if (drag) {
      drag = null;
      commit();
    }
  };
  overlay.addEventListener("pointerup", endDrag, { signal });
  const cancelDrag = (): void => {
    if (!drag) return;
    for (const { target, original } of drag.objects) Object.assign(target, original);
    drag = null;
    draw();
  };
  overlay.addEventListener("pointercancel", cancelDrag, { signal });
  overlay.addEventListener("lostpointercapture", cancelDrag, { signal });
  const setPan = (value: boolean): void => {
    cancelDrag(); panMode = value;
    overlay.dataset.pan = String(value);
    q("[data-select-mode]").setAttribute("aria-pressed", String(!value));
    q("[data-pan-mode]").setAttribute("aria-pressed", String(value));
  };
  listen("[data-select-mode]", () => setPan(false));
  listen("[data-pan-mode]", () => setPan(true));
  listen("[data-properties-toggle]", () => {
    const inspector = q<HTMLDetailsElement>(".direct-inspector");
    inspector.open = true; inspector.scrollIntoView({ block: "nearest" });
    inspector.querySelector<HTMLElement>("summary")?.focus();
  });
  if (matchMedia("(pointer: coarse)").matches) {
    setPan(true);
    q<HTMLDetailsElement>(".direct-inspector").open = false;
  }
  root.querySelectorAll<HTMLButtonElement>("[data-nudge]").forEach(button => {
    button.addEventListener("click", () => {
      if (!activeFrame() || busy) return;
      const targets = cropMode ? [plan.crops[String(currentPage)]!] : chosen().filter(o => o.page === currentPage);
      for (const o of targets) Object.assign(o, constrain({ ...o,
        x: o.x + (button.dataset.nudge === "right" ? 5 : button.dataset.nudge === "left" ? -5 : 0),
        y: o.y + (button.dataset.nudge === "down" ? 5 : button.dataset.nudge === "up" ? -5 : 0)
      }, activeFrame()!));
      commit();
    }, { signal });
  });
  root.addEventListener(
    "keydown",
    (e) => {
      if (
        e.target instanceof HTMLInputElement ||
        e.target instanceof HTMLTextAreaElement ||
        e.target instanceof HTMLSelectElement ||
        busy
      )
        return;
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "z") {
        e.preventDefault();
        plan = e.shiftKey ? history.redo() : history.undo();
        selected.clear();
        runtime.changed?.();
        draw();
        return;
      }
      const object = (e.target as Element).closest<HTMLElement>(
        "[data-object]",
      );
      if (object && (e.key === "Enter" || e.key === " ")) {
        e.preventDefault();
        selected = new Set([object.dataset.object!]);
        cropMode = false;
        draw();
        return;
      }
      if (e.key === "Delete" || e.key === "Backspace") {
        e.preventDefault();
        remove();
        return;
      }
      if (
        ["ArrowLeft", "ArrowRight", "ArrowUp", "ArrowDown"].includes(e.key) &&
        activeFrame()
      ) {
        e.preventDefault();
        const targets = cropMode
          ? [plan.crops[String(currentPage)]!]
          : chosen().filter((o) => o.page === currentPage);
        for (const o of targets)
          Object.assign(
            o,
            constrain(
              {
                ...o,
                x:
                  o.x +
                  (e.key === "ArrowRight"
                    ? 1
                    : e.key === "ArrowLeft"
                      ? -1
                      : 0) *
                    (e.shiftKey ? 10 : 1),
                y:
                  o.y +
                  (e.key === "ArrowDown" ? 1 : e.key === "ArrowUp" ? -1 : 0) *
                    (e.shiftKey ? 10 : 1),
              },
              activeFrame()!,
            ),
          );
        commit();
      }
    },
    { signal },
  );
  function setBusy(value: boolean): void {
    busy = value;
    runtime.busy(value);
    q<HTMLButtonElement>("#run-operation").disabled = value || !source || !viewer;
    q<HTMLButtonElement>("#cancel-operation").disabled = !value;
    q<HTMLInputElement>("#workspace-file").disabled = value;
    root
      .querySelectorAll<
        | HTMLInputElement
        | HTMLButtonElement
        | HTMLSelectElement
        | HTMLTextAreaElement
      >(".direct-toolbar input,.direct-toolbar button,.direct-navigation input,.direct-navigation button,.direct-navigation select,.direct-inspector input,.direct-inspector button,.direct-inspector textarea")
      .forEach((c) => {
        c.disabled = value;
      });
    if (!value) properties();
  }
  q<HTMLInputElement>("#workspace-file").addEventListener(
    "change",
    async (e) => {
      const input = e.target as HTMLInputElement,
        file = input.files?.[0];
      input.value = "";
      if (!file || busy) return;
      const ticket = ++generation;
      source = file;
      runtime.inputs([file]);
      error.hidden = true;
      q("[data-highlight-notice]").hidden = true;
      q("[data-download]").replaceChildren();
      urls.forEach(URL.revokeObjectURL);
      urls = [];
      overlay.replaceChildren();
      q("[data-objects]").replaceChildren();
      canvas.width = canvas.height = 1;
      selected.clear();
      frames = [];
      plan = emptyPlan();
      history = new EditHistory();
      cropMode = false;
      setBusy(true);
      stage.textContent = "Opening PDF…";
      try {
        await viewer?.destroy();
        viewer = null;
        const bytes = await file.arrayBuffer();
        if (disposed || ticket !== generation) return;
        running = runWorkerOperation(
          "direct-edit-inspect",
          [{ name: file.name, type: file.type, buffer: bytes.slice(0) }],
          {},
          () => {},
        );
        const result = await running.result;
        running = null;
        if (disposed || ticket !== generation) return;
        frames = JSON.parse(String(result.info?.frames)) as PageFrame[];
        plan.objects = JSON.parse(
          String(result.info?.comments),
        ) as EditObject[];
        history = new EditHistory(plan);
        const preserved = Number(result.info?.preservedHighlights) || 0;
        q("[data-highlight-notice]").hidden = preserved === 0;
        q("[data-highlight-notice]").textContent = `${preserved} existing highlight${preserved === 1 ? " is" : "s are"} kept unchanged. Multi-region, locked or otherwise unsupported highlights cannot be edited here.`;
        const next = await createPreview(result.outputs[0]?.buffer ?? bytes, canvas, stage);
        if (disposed || ticket !== generation) {
          await next.destroy();
          return;
        }
        viewer = next;
        setBusy(false);
        await show(1);
      } catch (e) {
        if (ticket === generation) failure(e);
      } finally {
        if (!disposed && ticket === generation) setBusy(false);
      }
    },
    { signal },
  );
  listen("#cancel-operation", () => {
    generation++;
    running?.cancel();
    running = null;
    setBusy(false);
    stage.textContent = "Cancelled. Your source PDF is unchanged.";
  });
  listen("#run-operation", () => {
    void (async () => {
      if (!source || !viewer || busy) return;
      const ticket = ++generation;
      error.hidden = true;
      setBusy(true);
      stage.textContent = "Exporting edits locally…";
      try {
        const buffer = await source.arrayBuffer();
        const files = [{ name: source.name, type: source.type, buffer }];
        if (plan.objects.some((o) => o.kind === "text")) {
          const response = await fetch(
            `${import.meta.env.BASE_URL}fonts/DocFlowSans.woff`,
            { signal },
          );
          if (!response.ok)
            throw new Error(
              "Unicode font is unavailable. Connect once and retry.",
            );
          files.push({
            name: "DocFlowSans.woff",
            type: "font/ttf",
            buffer: await response.arrayBuffer(),
          });
        }
        if (disposed || ticket !== generation) return;
        running = runWorkerOperation("direct-edit", files, { plan }, () => {});
        const result = await running.result;
        if (disposed || ticket !== generation) return;
        runtime.result(result);
        urls.forEach(URL.revokeObjectURL);
        urls = [];
        const link = document.createElement("a");
        const output = result.outputs[0]!;
        link.href = URL.createObjectURL(
          new Blob([output.buffer], { type: output.type }),
        );
        urls.push(link.href);
        link.download = output.name;
        link.textContent = "Download edited PDF";
        q("[data-download]").replaceChildren(link);
        addShareButton(link, new Blob([output.buffer], { type: output.type }));
        stage.textContent =
          "Edits ready. Download the PDF or use the result to continue.";
      } catch (e) {
        if (ticket === generation) failure(e);
      } finally {
        if (!disposed && ticket === generation) {
          running = null;
          setBusy(false);
        }
      }
    })();
  });
  let observedWidth = 0;
  const observer = new ResizeObserver((entries) => {
    const width = entries[0]?.contentRect.width ?? 0;
    if (width <= 0) return; // The dedicated result page temporarily hides this mounted editor.
    if (Math.abs(width - observedWidth) < 1) return;
    observedWidth = width;
    if (
      viewer &&
      !busy &&
      !drag &&
      q<HTMLSelectElement>("[data-zoom]").value === "fit"
    )
      void show(currentPage);
  });
  observer.observe(q(".direct-scroll"));
  root.addEventListener(
    "docflow-cleanup",
    () => {
      disposed = true;
      generation++;
      events.abort();
      observer.disconnect();
      running?.cancel();
      pad.dispose();
      void viewer?.destroy();
      urls.forEach(URL.revokeObjectURL);
      source = null;
      plan = emptyPlan();
    },
    { once: true },
  );
  properties();
}
