import { afterEach, expect, it, vi } from 'vitest';
import { addOutputSharing } from '../src/app/fileExport';

class Control {
  type = ''; className = ''; textContent = ''; disabled = false;
  handlers = new Map<string, () => void>();
  setAttribute(): void {}
  addEventListener(type: string, handler: () => void): void { this.handlers.set(type, handler); }
}
afterEach(() => vi.unstubAllGlobals());
it('shares each actual output when two download links have the same filename', async () => {
  const buttons: Control[] = [], shared: File[] = [];
  vi.stubGlobal('document', { createElement: () => new Control() });
  vi.stubGlobal('navigator', { canShare: () => true, share: async ({ files }: { files: File[] }) => { shared.push(files[0]!); } });
  const links = [0, 1].map(() => ({ download: 'same.pdf', after: (button: Control) => { buttons.push(button); } }));
  const host = { querySelectorAll: () => links } as unknown as HTMLElement;
  addOutputSharing(host, ['FIRST PDF', 'SECOND DISTINCT PDF'].map(text => ({ name: 'same.pdf', type: 'application/pdf', buffer: new TextEncoder().encode(text).buffer as ArrayBuffer })));
  expect(buttons).toHaveLength(2);
  buttons[1]!.handlers.get('click')!();
  expect(await shared[0]!.text()).toBe('SECOND DISTINCT PDF');
  buttons[0]!.handlers.get('click')!();
  expect(await shared[1]!.text()).toBe('FIRST PDF');
});
