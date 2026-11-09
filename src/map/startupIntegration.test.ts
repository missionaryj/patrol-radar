import { describe, expect, it, vi } from 'vitest';
vi.mock('leaflet', () => ({ default: {} }));
import { MapView } from './mapView';
function setup() {
  let ready!: () => void;
  const view = Object.create(MapView.prototype) as any;
  Object.assign(view, {
    viewReady: new Promise<void>(r => { ready = r; }), view3dRequest: 0,
    smooth: {}, follow: { following: true }, flockOn: false,
    map: { getCenter: () => ({ lat: 39, lng: -98 }), getZoom: () => 4 },
    m3: { open: vi.fn(async () => {}), close: vi.fn(), view: () => undefined, follow: vi.fn() },
    mirror3d: vi.fn(), kick: vi.fn(),
  });
  return { view, ready };
}
describe('map startup integration', () => {
  it('does not initialize 3D before the initial viewport and honors cancellation', async () => {
    const { view, ready } = setup(); const opening = view.set3D(true);
    expect(view.m3.open).not.toHaveBeenCalled();
    await view.set3D(false); ready(); await opening;
    expect(view.m3.open).not.toHaveBeenCalled(); expect(view.m3.close).toHaveBeenCalledOnce();
  });
  it('starts 3D at the first real location instead of the fallback city', async () => {
    const { view, ready } = setup(); const opening = view.set3D(true);
    view.smooth.disp = { lat: 33, lng: -84 }; view.map.getZoom = () => 16;
    ready(); await opening;
    expect(view.m3.open).toHaveBeenCalledWith({ lat: 33, lng: -84 }, 16);
  });
  it('catches up to GPS arriving during asynchronous 3D loading', async () => {
    const { view, ready } = setup(); let loaded!: () => void;
    view.m3.open.mockImplementation(() => new Promise<void>(r => { loaded = r; }));
    const opening = view.set3D(true); ready(); await Promise.resolve();
    view.smooth.disp = { lat: 33, lng: -84 }; view.map.getZoom = () => 16;
    loaded(); await opening;
    expect(view.m3.follow).toHaveBeenCalledWith(33, -84, 16);
  });
  it('does not snap back to GPS if the user pans while 3D loads', async () => {
    const { view, ready } = setup(); view.smooth.disp = { lat: 33, lng: -84 }; view.follow.following = false;
    const opening = view.set3D(true); ready(); await opening;
    expect(view.m3.follow).not.toHaveBeenCalled();
  });
  it.each(['drawFlock', 'drawTc', 'drawHeat'])('skips %s before there is a viewport', async method => {
    const { view } = setup(); view.waitingForLocation = true;
    await expect(view[method]()).resolves.toBeUndefined();
  });
});
