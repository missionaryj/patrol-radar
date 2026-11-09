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
    mirror3d: vi.fn(), kick: vi.fn(), present2D: vi.fn(), onPresentationChange: vi.fn(),
  });
  return { view, ready };
}
describe('map startup integration', () => {
  it('does not initialize 3D before the initial viewport and honors cancellation', async () => {
    const { view, ready } = setup(); const opening = view.set3D(true);
    expect(view.m3.open).not.toHaveBeenCalled();
    const closing = view.set3D(false); ready(); await closing; await opening;
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

describe('direct 3D presentation', () => {
  it('keeps 2D suppressed and loading visible until 3D finishes', async () => {
    const { view, ready } = setup(); let loaded!: () => void;
    view.m3.open.mockImplementation(() => new Promise<void>(r => { loaded = r; }));
    const opening = view.set3D(true);
    expect(view.present2D).toHaveBeenCalledWith(false);
    expect(view.onPresentationChange.mock.calls).toEqual([['loading3d']]);
    ready(); await Promise.resolve();
    expect(view.onPresentationChange.mock.calls).toEqual([['loading3d']]);
    loaded(); await opening;
    expect(view.onPresentationChange.mock.calls).toEqual([['loading3d'], ['ready']]);
    expect(view.present2D.mock.calls).toEqual([[false]]);
  });
  it('loads 2D only after a 3D failure and reports the fallback', async () => {
    const { view, ready } = setup(); view.on3DFailure = vi.fn();
    view.m3.open.mockRejectedValue(new Error('WebGL unavailable'));
    const opening = view.set3D(true); ready(); await opening;
    expect(view.present2D.mock.calls).toEqual([[false], [true]]);
    expect(view.wants3D).toBe(false);
    expect(view.on3DFailure).toHaveBeenCalledOnce();
    expect(view.onPresentationChange).toHaveBeenLastCalledWith('fallback');
  });
  it('does not reveal a cancelled 3D view after choosing 2D', async () => {
    const { view, ready } = setup(); let loaded!: () => void;
    view.m3.open.mockImplementation(() => new Promise<void>(r => { loaded = r; }));
    const opening = view.set3D(true); ready(); await Promise.resolve();
    await view.set3D(false); loaded(); await opening;
    expect(view.present2D.mock.calls).toEqual([[false], [true]]);
    expect(view.mirror3d).not.toHaveBeenCalled();
    expect(view.onPresentationChange.mock.calls).toEqual([['loading3d'], ['ready']]);
  });
  it('removes the raster source while 3D is selected, not just its pixels', () => {
    const { view } = setup(); const pane = { style: { visibility: '' } };
    view.map.getPane = () => pane;
    view.map.hasLayer = () => false;
    view.mapHasView = true;
    view.raster = { addTo: vi.fn(), remove: vi.fn() };
    delete view.present2D;
    view.present2D(false);
    expect(pane.style.visibility).toBe('hidden');
    expect(view.raster.remove).toHaveBeenCalledOnce();
    expect(view.raster.addTo).not.toHaveBeenCalled();
    view.present2D(true);
    expect(pane.style.visibility).toBe('');
    expect(view.raster.addTo).toHaveBeenCalledWith(view.map);
  });
  it('does not attach street tiles before the map has a center', () => {
    const { view } = setup(); const pane = { style: { visibility: '' } };
    view.map.getPane = () => pane;
    view.map.hasLayer = () => false;
    view.mapHasView = false;
    view.raster = { addTo: vi.fn(), remove: vi.fn() };
    delete view.present2D;
    expect(() => view.present2D(true)).not.toThrow();
    expect(view.raster.addTo).not.toHaveBeenCalled();
    view.mapHasView = true;
    view.attachBasemap();
    expect(view.raster.addTo).toHaveBeenCalledOnce();
  });
});
