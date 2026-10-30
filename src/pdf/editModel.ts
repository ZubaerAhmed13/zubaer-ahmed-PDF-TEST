/** Coordinates are points in the rotated, visible page, with a top-left origin. */
export interface PageFrame {
  x: number;
  y: number;
  width: number;
  height: number;
  rotation: number;
}
export interface Rect {
  x: number;
  y: number;
  width: number;
  height: number;
}
export interface EditObject extends Rect {
  id: string;
  page: number;
  kind: "text" | "rectangle" | "highlight" | "native-highlight" | "image" | "signature" | "comment";
  text?: string;
  color: string;
  size: number;
  data?: string;
  originalId?: string;
  opacity?: number;
}
export interface EditPlan {
  source?: import('./nativeModel').NativeEditPlan;
  objects: EditObject[];
  crops: Record<string, Rect>;
  removedComments: string[];
}
export const emptyPlan = (): EditPlan => ({
  objects: [],
  crops: {},
  removedComments: [],
});
export function displaySize(frame: PageFrame): {
  width: number;
  height: number;
} {
  return frame.rotation % 180
    ? { width: frame.height, height: frame.width }
    : { width: frame.width, height: frame.height };
}
export function toPdf(
  frame: PageFrame,
  x: number,
  y: number,
): [number, number] {
  switch (((frame.rotation % 360) + 360) % 360) {
    case 90:
      return [frame.x + y, frame.y + x];
    case 180:
      return [frame.x + frame.width - x, frame.y + y];
    case 270:
      return [frame.x + frame.width - y, frame.y + frame.height - x];
    default:
      return [frame.x + x, frame.y + frame.height - y];
  }
}
export function toDisplay(
  frame: PageFrame,
  x: number,
  y: number,
): [number, number] {
  const dx = x - frame.x,
    dy = y - frame.y;
  switch (((frame.rotation % 360) + 360) % 360) {
    case 90:
      return [dy, dx];
    case 180:
      return [frame.width - dx, dy];
    case 270:
      return [frame.height - dy, frame.width - dx];
    default:
      return [dx, frame.height - dy];
  }
}
export function pdfBounds(frame: PageFrame, rect: Rect): Rect {
  const points = [
    toPdf(frame, rect.x, rect.y),
    toPdf(frame, rect.x + rect.width, rect.y + rect.height),
  ];
  return {
    x: Math.min(...points.map((p) => p[0])),
    y: Math.min(...points.map((p) => p[1])),
    width: Math.abs(points[1]![0] - points[0]![0]),
    height: Math.abs(points[1]![1] - points[0]![1]),
  };
}
export function constrain(rect: Rect, frame: PageFrame, snap = false): Rect {
  const size = displaySize(frame);
  const width = Math.max(8, Math.min(size.width, rect.width)),
    height = Math.max(8, Math.min(size.height, rect.height));
  let x = Math.max(0, Math.min(size.width - width, rect.x)),
    y = Math.max(0, Math.min(size.height - height, rect.y));
  if (snap) {
    for (const target of [0, (size.width - width) / 2, size.width - width])
      if (Math.abs(x - target) <= 5) x = target;
    for (const target of [0, (size.height - height) / 2, size.height - height])
      if (Math.abs(y - target) <= 5) y = target;
  }
  return { x, y, width, height };
}
export class EditHistory {
  private states: EditPlan[];
  private index = 0;
  constructor(plan = emptyPlan()) {
    this.states = [structuredClone(plan)];
  }
  get current(): EditPlan {
    return structuredClone(this.states[this.index]!);
  }
  get canUndo(): boolean {
    return this.index > 0;
  }
  get canRedo(): boolean {
    return this.index < this.states.length - 1;
  }
  commit(plan: EditPlan): boolean {
    const serialized = JSON.stringify(plan);
    if (serialized.length > 16 * 1024 * 1024)
      throw new Error(
        "The edit plan exceeds the 16 MB local memory budget. Use fewer or smaller images.",
      );
    if (serialized === JSON.stringify(this.states[this.index])) return false;
    this.states.splice(this.index + 1);
    this.states.push(structuredClone(plan));
    while (
      this.states.length > 2 &&
      (this.states.length > 65 ||
        this.states.reduce(
          (sum, state) => sum + JSON.stringify(state).length,
          0,
        ) >
          32 * 1024 * 1024)
    )
      this.states.shift();
    this.index = this.states.length - 1;
    return true;
  }
  undo(): EditPlan {
    if (this.canUndo) this.index--;
    return this.current;
  }
  redo(): EditPlan {
    if (this.canRedo) this.index++;
    return this.current;
  }
}
