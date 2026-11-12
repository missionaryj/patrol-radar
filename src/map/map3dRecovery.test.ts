import { afterEach, describe, expect, it, vi } from 'vitest';

const fake = vi.hoisted(() => ({ instances: [] as any[] }));
vi.mock('maplibre-gl', () => ({ default: { Map: class {
  handlers: Record<string, Function> = {};
  removed = false;
  options: any; jumps: any[] = [];
  constructor(options: any) { this.options = options; fake.instances.push(this); }
  jumpTo(options: any) { this.jumps.push(options); }
  getZoom() { return 17; } getPitch() { return 62; } setPaintProperty() {}
  on(event: string, ...args: any[]) { this.handlers[event] = args[args.length - 1]; }
  off() {}
  emit(event: string) { this.handlers[event]?.({}); }
  remove() { this.removed = true; }
  addSource() {} addLayer() {} getSource() { return undefined; } getLayer() { return undefined; }
} } }));
vi.mock('maplibre-gl/dist/maplibre-gl.css', () => ({}));
import { Map3D } from './map3d';

async function flushImports() { for (let i = 0; i < 20 && !fake.instances.length; i++) await new Promise(r => setTimeout(r, 0)); }
function setup() {
  const el = { hidden: true, clientHeight: 1000, style: { visibility: '' } } as unknown as HTMLElement;
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


describe('navigation and patrol camera integration', () => {
  it('keeps navigation heading follow while preserving patrol zoom limits', async () => {
    vi.stubGlobal('window', { devicePixelRatio: 1 });
    const { map } = setup();
    map.setDrivingMode(true);
    const opening = map.open({ lat: 1, lng: 2 }, 17);
    await flushImports(); const instance = fake.instances[0];
    instance.emit('load'); await opening;
    expect(instance.options.pitch).toBe(60);
    map.follow(1, 2, 17, 90);
    expect(instance.jumps.at(-1)).toMatchObject({zoom:17, bearing:90, padding:{top:400,bottom:0}});
    map.setDrivingMode(false); 
    expect(instance.jumps.at(-1).padding).toEqual({top:0,bottom:0,left:0,right:0});
    map.setPatrolMoving(true);
    map.follow(1, 2, 21, 180);
    expect(instance.jumps.at(-1).zoom).toBeLessThan(19);
    expect(instance.jumps.at(-1).bearing).toBe(180);
    map.setDrivingMode(true); map.follow(1, 2, 17, 270);
    expect(instance.jumps.at(-1)).toMatchObject({zoom:17, bearing:270});
    map.close();
  });
});
