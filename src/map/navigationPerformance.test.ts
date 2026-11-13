import { afterEach, describe, expect, it, vi } from 'vitest';
vi.mock('leaflet', () => ({ default: {} }));
import { MapView, shouldSyncLeaflet } from './mapView';
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

  it('throttles hidden Leaflet updates but never throttles visible 2D', () => {
    expect(shouldSyncLeaflet(true, 1000, 0)).toBe(true);
    expect(shouldSyncLeaflet(true, 1050, 1000)).toBe(false);
    expect(shouldSyncLeaflet(true, 1349, 1000)).toBe(false);
    expect(shouldSyncLeaflet(true, 1350, 1000)).toBe(true);
    expect(shouldSyncLeaflet(false, 1050, 1000)).toBe(true);
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
