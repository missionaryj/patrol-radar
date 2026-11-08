import { afterEach, describe, expect, it, vi } from 'vitest';
vi.mock('leaflet', () => {
  class CircleMarker {
    constructor(public point: number[], public options: any) {}
    getLatLng() { return { lat: this.point[0], lng: this.point[1] }; }
    getRadius() { return 5; }
    bindPopup(html: string) { this.html = html; return this; }
    html = '';
    getPopup() { return { getContent: () => this.html }; }
    addTo(group: any) { group.items.push(this); return this; }
  }
  return { default: { CircleMarker, Rectangle: class {}, Circle: class {}, Marker: class {}, circleMarker: (p: number[], o: any) => new CircleMarker(p, o), latLngBounds: (sw: number[], ne: number[]) => ({ pad() { return this; }, getSouth: () => sw[0], getWest: () => sw[1], getNorth: () => ne[0], getEast: () => ne[1] }) } };
});
import { MapView } from './mapView';
function group() { return { items: [] as any[], eachLayer(fn: Function) { this.items.forEach(x => fn(x)); }, clearLayers() { this.items = []; }, remove() {} }; }
function setup() {
  const view = Object.create(MapView.prototype) as any;
  const bounds = { getSouth: () => 40, getNorth: () => 41, getWest: () => -90, getEast: () => -89 };
  const update = vi.fn();
  Object.assign(view, { flockOn: true, flockDraw: 0, flockIdx: { tileDeg: 5, tiles: { '40_-90': 1 } }, flockLayer: group(), layer: group(), crowdLayer: group(), liveLayer: group(), smooth: {},
    m3: { active: true, view: () => ({ zoom: 16 }), bounds: () => bounds, update },
    map: { getZoom: () => 5, getBounds: () => { throw new Error('Must use 3D viewport'); }, attributionControl: { removeAttribution() {} } },
    tile: vi.fn(async () => ({ features: [{ geometry: { coordinates: [-89.5, 40.5] }, properties: { id: 123 } }] })) });
  return { view, update };
}
afterEach(() => vi.restoreAllMocks());
describe('Flock cameras in 3D', () => {
  it('loads the active 3D viewport and mirrors cyan cameras with their popup while scanning is idle', async () => {
    const { view, update } = setup(); await view.drawFlock();
    expect(view.tile).toHaveBeenCalledWith('40_-90');
    expect(update.mock.lastCall?.[0].pins).toEqual([expect.objectContaining({ lat: 40.5, lng: -89.5, color: '#00e5ff', html: expect.stringContaining('OSM node') })]);
  });
  it('removes cameras immediately when disabled and ignores a pending tile response', async () => {
    const { view, update } = setup(); await view.drawFlock();
    let resolve!: (v: any) => void;
    view.tile = () => new Promise(r => { resolve = r; });
    const pending = view.drawFlock(); await view.showFlock(false, '/data/flock/');
    resolve({ features: [{ geometry: { coordinates: [-89.5, 40.5] }, properties: { id: 123 } }] }); await pending;
    expect(view.flockLayer.items).toHaveLength(0); expect(update.mock.lastCall?.[0].pins).toEqual([]);
  });
  it('clears 3D cameras below the minimum zoom', async () => {
    const { view, update } = setup(); await view.drawFlock(); view.m3.view = () => ({ zoom: 9 }); await view.drawFlock();
    expect(update.mock.lastCall?.[0].pins).toEqual([]);
  });
});
