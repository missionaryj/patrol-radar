import { afterEach, describe, expect, it, vi } from 'vitest';
vi.mock('leaflet', () => ({ default: {} }));
import { MapView } from './mapView';
import { Map3D } from './map3d';

afterEach(() => vi.unstubAllGlobals());

describe('navigation camera lifecycle', () => {
  it('ends the driving camera and clears the old heading when a route ends', () => {
    const view = Object.create(MapView.prototype) as any;
    view.driving = true; view.drivingHeading = 270;
    view.m3 = { setDrivingMode: vi.fn() };
    view.setDrivingMode(false);
    expect(view.drivingCamera).toBe(false);
    expect(view.drivingHeading).toBeUndefined();
    expect(view.m3.setDrivingMode).toHaveBeenCalledWith(false);
  });

  it('does not move the hidden Leaflet map on every frame while 3D is active', () => {
    vi.stubGlobal('document', { hidden: false });
    vi.stubGlobal('requestAnimationFrame', vi.fn(() => 1));
    const view = Object.create(MapView.prototype) as any;
    const me = { setLatLng: vi.fn() }, acc = { setLatLng: vi.fn(() => acc), setRadius: vi.fn() };
    Object.assign(view, {
      driving: true, patrolMoving: false, lastFrame: 0, last3DFollow: 0, lastLeafletFollow: 0,
      lastMirror: 1e9, mirror3d: vi.fn(), moveRel: vi.fn(),
      smooth: { tick: vi.fn(() => true), disp: { lat: 41.88, lng: -87.63 }, acc: 12 },
      me, meAcc: acc, map: { setView: vi.fn(), getZoom: () => 17 },
      follow: { onFix: () => true },
      m3: { active: true, follow: vi.fn(), updateLocation: vi.fn() },
    });
    view.frame(1000); view.frame(1050); view.frame(1400);
    expect(view.map.setView).toHaveBeenCalledTimes(2);
    expect(me.setLatLng).toHaveBeenCalledTimes(2);
    expect(view.moveRel).toHaveBeenCalledTimes(2);
    expect(view.m3.follow).toHaveBeenCalledTimes(3);
    expect(view.m3.updateLocation).toHaveBeenCalledTimes(3);
  });

  it('updates only the 3D user dot and accuracy sources between full overlay mirrors', () => {
    const view = Object.create(Map3D.prototype) as any;
    const sources: Record<string, ReturnType<typeof vi.fn>> = { me: vi.fn(), acc: vi.fn() };
    view.map = { getSource: (id: string) => ({ setData: sources[id] }) };
    view.ready = true; view.pending = { pins: [{lat:0,lng:0,color:'red',r:5,kind:'dot'}] };
    view.updateLocation(41.88, -87.63, 12);
    expect(view.pending.me).toEqual({ lat: 41.88, lng: -87.63, acc: 12 });
    expect(view.pending.pins).toHaveLength(1);
    expect(sources.me).toHaveBeenCalledOnce();
    expect(sources.acc).toHaveBeenCalledOnce();
    expect(sources.me.mock.calls[0][0].features[0].geometry.coordinates).toEqual([-87.63,41.88]);
  });
});
