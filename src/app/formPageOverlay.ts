import { workspaceRuntime } from "./workspaceRuntime";
import { renderedPage, type RenderedPage } from "../pdf/render";
import {
  normalizeInspectedFields,
  type InspectedFormField,
} from "./visualFormEditor";
import "../styles/form-page-overlay.css";

/** Shares the existing JSON source of truth with the accessible field list. */
export function mountFormPageOverlay(
  root: HTMLElement,
  advanced: HTMLTextAreaElement,
  rawFields: unknown,
  review: (flattened: boolean) => Promise<void>,
): { dispose(): void } {
  const runtime = workspaceRuntime(root);
  const fields = normalizeInspectedFields(rawFields),
    events = new AbortController(),
    signal = events.signal;
  const values = (): Record<string, unknown> => {
    try {
      return JSON.parse(advanced.value || "{}") as Record<string, unknown>;
    } catch {
      return {};
    }
  };
  let surface: HTMLElement | null = null,
    current: RenderedPage | undefined,
    pending = "",
    index = -1,
    reviewing = false;
  const controls: {
    field: InspectedFormField;
    input: HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement;
    choice?: string;
  }[] = [];
  const actions = document.createElement("div");
  actions.className = "form-overlay-actions";
  actions.innerHTML =
    '<button type="button" data-form-review>Review flattened appearance</button><span data-review-status role="status"></span><button type="button" data-field-prev>Previous field</button><button type="button" data-field-next>Next field</button><p>On-page controls and the field list share the same values. Required fields must be completed. Read-only fields stay unchanged. Review values before flattening; flattening makes the exported fields permanent.</p>';
  root
    .querySelector("[data-visual-form-editor], #visual-form-editor")
    ?.prepend(actions);
  if (!actions.isConnected) advanced.before(actions);
  function sync(): void {
    const state = values();
    for (const { field, input, choice } of controls) {
      const value = state[field.name];
      if (input instanceof HTMLInputElement && input.type === "checkbox")
        input.checked = value === true;
      else if (input instanceof HTMLInputElement && input.type === "radio")
        input.checked = value === choice;
      else if (input instanceof HTMLSelectElement && input.multiple)
        for (const option of input.options)
          option.selected =
            Array.isArray(value) && value.includes(option.value);
      else input.value = typeof value === "string" ? value : "";
      input.hidden = reviewing;
    }
  }
  function teardown(): void {
    controls.length = 0;
    if (surface) {
      const canvas = surface.querySelector("canvas");
      if (canvas) surface.before(canvas);
      surface.remove();
      surface = null;
    }
  }
  function render(detail: RenderedPage): void {
    current = detail;
    teardown();
    const { canvas, viewport, pageNumber } = detail;
    surface = document.createElement("div");
    surface.className = "form-page-surface";
    surface.style.width = `${viewport.width}px`;
    surface.style.height = `${viewport.height}px`;
    canvas.before(surface);
    surface.append(canvas);
    for (const field of fields.slice(0, 250))
      for (const widget of field.widgets ?? []) {
        if (
          widget.page !== pageNumber ||
          !widget.rect ||
          !Object.values(widget.rect).every(Number.isFinite)
        )
          continue;
        const rect = widget.rect,
          points = viewport.convertToViewportRectangle([
            rect.x,
            rect.y,
            rect.x + rect.width,
            rect.y + rect.height,
          ]);
        let input: HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement;
        if (field.type === "text")
          input = document.createElement(
            field.multiline ? "textarea" : "input",
          );
        else if (field.type === "checkbox" || field.type === "radio") {
          input = document.createElement("input");
          input.type = field.type;
          if (field.type === "radio")
            input.name = "overlay-radio-" + field.name;
        } else if (["dropdown", "option-list"].includes(field.type)) {
          input = document.createElement("select");
          input.multiple = field.type === "option-list";
          if (!input.multiple) input.append(new Option("Select an option", ""));
          for (const choice of field.choices ?? [])
            input.append(new Option(choice, choice));
        } else continue;
        input.className = "form-page-input";
        input.dataset.field = field.name;
        input.setAttribute(
          "aria-label",
          `On page ${pageNumber}: ${field.name}${field.type === "radio" ? " · " + (field.choices?.[(field.widgets ?? []).indexOf(widget)] ?? widget.choice ?? "") : ""}`,
        );
        input.required = field.required === true;
        input.disabled = field.readOnly === true;
        input.title = `${field.name}${field.required ? " · Required" : ""}${field.readOnly ? " · Read only" : ""}`;
        Object.assign(input.style, {
          left: `${Math.min(points[0], points[2])}px`,
          top: `${Math.min(points[1], points[3])}px`,
          width: `${Math.max(12, Math.abs(points[2] - points[0]))}px`,
          height: `${Math.max(12, Math.abs(points[3] - points[1]))}px`,
          fontSize: `${Math.max(10, 12 * viewport.scale)}px`,
        });
        input.addEventListener(
          field.type === "text" ? "input" : "change",
          () => {
            const state = values();
            let value: unknown = input.value;
            if (input instanceof HTMLInputElement && input.type === "checkbox")
              value = input.checked;
            else if (
              input instanceof HTMLInputElement &&
              input.type === "radio"
            ) {
              if (!input.checked) return;
              const choiceIndex = (field.widgets ?? []).indexOf(widget);
              value =
                field.choices?.[choiceIndex] ?? widget.choice ?? input.value;
            } else if (input instanceof HTMLSelectElement && input.multiple)
              value = [...input.selectedOptions].map((o) => o.value);
            Object.defineProperty(state, field.name, {
              value,
              enumerable: true,
              writable: true,
              configurable: true,
            });
            advanced.value = JSON.stringify(state, null, 2);
            advanced.dispatchEvent(new Event("input", { bubbles: true }));
            runtime.changed?.();
          },
          { signal },
        );
        const widgetIndex = (field.widgets ?? []).indexOf(widget);
        controls.push({
          field,
          input,
          choice:
            field.type === "radio"
              ? (field.choices?.[widgetIndex] ?? widget.choice)
              : undefined,
        });
        surface.append(input);
      }
    sync();
    if (pending) {
      controls.find((c) => c.field.name === pending)?.input.focus();
      pending = "";
    }
  }
  root.addEventListener(
    "docflow-page-rendered",
    (e) => {
      const detail = (e as CustomEvent<RenderedPage>).detail;
      if (detail.canvas.closest(".pre-edit-preview")) render(detail);
    },
    { signal },
  );
  const reviewButton =
    actions.querySelector<HTMLButtonElement>("[data-form-review]")!;
  const reviewStatus = actions.querySelector<HTMLElement>(
    "[data-review-status]",
  )!;
  reviewButton.addEventListener(
    "click",
    () => {
      void (async () => {
        reviewButton.disabled = true;
        try {
          await review(!reviewing);
          if (signal.aborted) return;
          reviewing = !reviewing;
          sync();
          reviewButton.textContent = reviewing
            ? "Return to editable fields"
            : "Review flattened appearance";
          reviewStatus.textContent = reviewing
            ? "Exact flattened PDF appearance. Field editing overlays are hidden."
            : "Editable fields restored.";
        } catch (e) {
          if (!signal.aborted)
            reviewStatus.textContent =
              e instanceof Error ? e.message : "Preview failed.";
        } finally {
          if (!signal.aborted) reviewButton.disabled = false;
        }
      })();
    },
    { signal },
  );
  advanced.addEventListener(
    "input",
    () => {
      sync();
      if (reviewing)
        reviewStatus.textContent =
          "Values changed since this preview. Return to editable fields, then review again before flattening.";
    },
    { signal },
  );
  const navigate = (direction: number): void => {
    const targets = fields.filter((f) => f.widgets?.length && !f.readOnly);
    if (!targets.length) return;
    index = (index + direction + targets.length) % targets.length;
    const field = targets[index]!,
      page = field.widgets![0]!.page;
    pending = field.name;
    if (current?.pageNumber === page) {
      controls.find((c) => c.field.name === field.name)?.input.focus();
      pending = "";
    } else
      root.dispatchEvent(
        new CustomEvent("docflow-preview-page", { detail: { page } }),
      );
  };
  actions
    .querySelector("[data-field-prev]")!
    .addEventListener("click", () => navigate(-1), { signal });
  actions
    .querySelector("[data-field-next]")!
    .addEventListener("click", () => navigate(1), { signal });
  const canvas = root.querySelector<HTMLCanvasElement>(
    ".pre-edit-canvas-shell canvas",
  );
  if (canvas) {
    const detail = renderedPage(canvas);
    if (detail) render(detail);
  }
  return {
    dispose() {
      events.abort();
      teardown();
      actions.remove();
      current = undefined;
    },
  };
}
