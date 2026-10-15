/**
 * Browser-only ink signature pad. No signature is persisted, uploaded or
 * transmitted outside the local processing worker.
 */
export function mountSignaturePad(host: HTMLElement): {
  getData: () => string;
  dispose: () => void;
} {
  host.replaceChildren();
  const intro = document.createElement('p');
  intro.className = 'help';
  intro.textContent = 'Draw using touch, pen or mouse, or enter a name below. This creates a visible mark, not a digital certificate.';
  const canvas = document.createElement('canvas');
  canvas.width = 720;
  canvas.height = 210;
  canvas.className = 'signature-drawing';
  canvas.setAttribute('role', 'img');
  canvas.setAttribute('aria-label', 'Draw your visual signature with a pointer. Typed name is also available.');
  const context = canvas.getContext('2d');
  if (!context) return { getData: () => '', dispose: () => host.replaceChildren() };
  context.lineWidth = 3.5;
  context.strokeStyle = '#203047';
  context.lineCap = 'round';
  context.lineJoin = 'round';
  let drawing = false;
  let hasInk = false;

  const position = (event: PointerEvent): [number, number] => {
    const r = canvas.getBoundingClientRect();
    return [(event.clientX - r.left) * canvas.width / Math.max(1, r.width), (event.clientY - r.top) * canvas.height / Math.max(1, r.height)];
  };
  const down = (event: PointerEvent): void => {
    if (event.pointerType === 'mouse' && event.button !== 0) return;
    event.preventDefault();
    canvas.setPointerCapture(event.pointerId);
    drawing = true;
    const [x, y] = position(event);
    context.beginPath();
    context.moveTo(x, y);
    context.lineTo(x + 0.01, y);
    context.stroke();
    hasInk = true;
  };
  const move = (event: PointerEvent): void => {
    if (!drawing) return;
    event.preventDefault();
    const [x, y] = position(event);
    context.lineTo(x, y);
    context.stroke();
  };
  const end = (): void => { drawing = false; };
  canvas.addEventListener('pointerdown', down);
  canvas.addEventListener('pointermove', move);
  canvas.addEventListener('pointerup', end);
  canvas.addEventListener('pointercancel', end);
  const clear = document.createElement('button');
  clear.type = 'button';
  clear.className = 'secondary';
  clear.textContent = 'Clear drawing';
  clear.addEventListener('click', () => {
    context.clearRect(0, 0, canvas.width, canvas.height);
    hasInk = false;
  });
  host.append(intro, canvas, clear);
  return {
    getData: () => hasInk ? canvas.toDataURL('image/png') : '',
    dispose: () => {
      canvas.removeEventListener('pointerdown', down);
      canvas.removeEventListener('pointermove', move);
      canvas.removeEventListener('pointerup', end);
      canvas.removeEventListener('pointercancel', end);
      context.clearRect(0, 0, canvas.width, canvas.height);
      host.replaceChildren();
    }
  };
}
