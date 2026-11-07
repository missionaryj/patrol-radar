import { afterEach, describe, expect, it, vi } from 'vitest';

const fake = vi.hoisted(() => ({ instances: [] as any[] }));
vi.mock('maplibre-gl', () => ({ default: { Map: class {
  handlers: Record<string, Function> = {};
  removed = false;
  constructor() { fake.instances.push(this); }
  on(event: string, ...args: any[]) { this.handlers[event] = args[args.length - 1]; }
  emit(event: string) { this.handlers[event]?.({}); }
  remove() { this.removed = true; }
  addSource() {} addLayer() {} getSource() { return undefined; } getLayer() { return undefined; }
} } }));
vi.mock('maplibre-gl/dist/maplibre-gl.css', () => ({}));
import { Map3D } from './map3d';

async function flushImports() { for (let i = 0; i < 20 && !fake.instances.length; i++) await new Promise(r => setTimeout(r, 0)); }
function setup() {
  const el = { hidden: true, style: { visibility: '' } } as unknown as HTMLElement;
  return { el, map: new Map3D(el, 'dark', () => {}) };
}
afterEach(() => { fake.instances.length = 0; vi.useRealTimers(); vi.unstubAllGlobals(); });

describe('3D map recovery', () => {
  it('keeps the 2D map visible until 3D has loaded', async () => {
    vi.stubGlobal('window', { devicePixelRatio: 1 });
    const { el, map } = setup(); const opening = map.open({ lat: 1, lng: 2 }, 16);
    await flushImports(); expect(el.style.visibility).toBe('hidden');
    fake.instances[0].emit('load'); await opening;
    expect(el.hidden).toBe(false); expect(el.style.visibility).toBe(''); map.close();
  });
  it('does not reopen after the user turns 3D off while it starts', async () => {
    vi.stubGlobal('window', { devicePixelRatio: 1 });
    const { el, map } = setup(); const opening = map.open({ lat: 1, lng: 2 }, 16);
    await flushImports(); const instance = fake.instances[0]; map.close(); await opening;
    instance.emit('load'); expect(instance.removed).toBe(true); expect(el.hidden).toBe(true); expect(map.active).toBe(false);
  });
  it('falls back to 2D when graphics initialization fails', async () => {
    vi.stubGlobal('window', { devicePixelRatio: 1 });
    const { el, map } = setup(); const opening = map.open({ lat: 1, lng: 2 }, 16);
    await flushImports(); fake.instances[0].emit('webglcontextlost');
    await expect(opening).rejects.toThrow('graphics context lost');
    expect(el.hidden).toBe(true); expect(map.active).toBe(false);
  });
  it('restores 2D if the graphics context is lost after loading', async () => {
    vi.stubGlobal('window', { devicePixelRatio: 1 });
    const el = { hidden: true, style: { visibility: '' } } as unknown as HTMLElement;
    const onFailure = vi.fn(); const map = new Map3D(el, 'dark', () => {}, onFailure);
    const opening = map.open({ lat: 1, lng: 2 }, 16); await flushImports();
    fake.instances[0].emit('load'); await opening;
    fake.instances[0].emit('webglcontextlost');
    expect(el.hidden).toBe(true); expect(map.active).toBe(false); expect(onFailure).toHaveBeenCalledOnce();
  });
});
