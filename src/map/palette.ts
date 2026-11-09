/** Basemap palette (cool slate). Police pins are red/orange/yellow; slate land keeps them high-contrast. */
export interface Palette { land: string; water: string; park: string; road: string; roadMajor: string; building: string; buildingTop: string; label: string; }
export const PALETTE: Record<'light' | 'dark', Palette> = {
  light: { land: '#e6e9ee', water: '#b9c7d6', park: '#d9e2dc', road: '#ffffff', roadMajor: '#f4f6f9', building: '#cfd5de', buildingTop: '#c3cad4', label: '#4b5563' },
  dark: { land: '#172235', water: '#0d1c2c', park: '#1b3540', road: '#6b7d95', roadMajor: '#c0d0e2', building: '#243246', buildingTop: '#374b64', label: '#e3edf7' },
};
/** 2D raster basemap: OSM tiles restyled to cool slate via CSS filters (.tiles-slate / .tiles-slate-dark), no API key. */
export const RASTER_2D = {
  light: 'https://tile.openstreetmap.org/{z}/{x}/{y}.png',
  dark: 'https://tile.openstreetmap.org/{z}/{x}/{y}.png',
  attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors',
};
/** 3D vector source: OpenFreeMap (OpenMapTiles schema, building render_height), no API key. */
export const VECTOR_TILEJSON = 'https://tiles.openfreemap.org/planet';
export const VECTOR_ATTRIBUTION = '<a href="https://openfreemap.org">OpenFreeMap</a> &copy; <a href="https://www.openmaptiles.org/">OpenMapTiles</a> &copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors';
export const MAX_PITCH = 60, PITCH_3D = 55, BUILDING_MIN_ZOOM = 14;

/** MapLibre style for the 3D view: slate land, water, roads, extruded buildings. Pure so it can be unit-tested. */
export function style3d(theme: 'light' | 'dark'): any {
  const c = PALETTE[theme];
  return {
    version: 8,
    sources: { omt: { type: 'vector', url: VECTOR_TILEJSON, attribution: VECTOR_ATTRIBUTION } },
    layers: [
      { id: 'land', type: 'background', paint: { 'background-color': c.land } },
      { id: 'park', type: 'fill', source: 'omt', 'source-layer': 'park', paint: { 'fill-color': c.park } },
      { id: 'landcover', type: 'fill', source: 'omt', 'source-layer': 'landcover', filter: ['in', ['get', 'class'], ['literal', ['wood', 'grass']]], paint: { 'fill-color': c.park, 'fill-opacity': 0.6 } },
      { id: 'water', type: 'fill', source: 'omt', 'source-layer': 'water', paint: { 'fill-color': c.water } },
      { id: 'roads', type: 'line', source: 'omt', 'source-layer': 'transportation', filter: ['!', ['in', ['get', 'class'], ['literal', ['motorway', 'trunk', 'primary']]]], paint: { 'line-color': c.road, 'line-opacity': 0.78, 'line-width': ['interpolate', ['linear'], ['zoom'], 12, 0.7, 18, 5.5] } },
      { id: 'roads-major', type: 'line', source: 'omt', 'source-layer': 'transportation', filter: ['in', ['get', 'class'], ['literal', ['motorway', 'trunk', 'primary']]], paint: { 'line-color': c.roadMajor, 'line-opacity': 0.95, 'line-width': ['interpolate', ['linear'], ['zoom'], 10, 1.3, 18, 8.5] } },
      { id: 'buildings-3d', type: 'fill-extrusion', source: 'omt', 'source-layer': 'building', minzoom: BUILDING_MIN_ZOOM,
        paint: { 'fill-extrusion-color': ['interpolate', ['linear'], ['coalesce', ['get', 'render_height'], 6], 0, c.building, 60, c.buildingTop],
          'fill-extrusion-height': ['coalesce', ['get', 'render_height'], 6], 'fill-extrusion-base': ['coalesce', ['get', 'render_min_height'], 0], 'fill-extrusion-opacity': 0.85 } },
      { id: 'place-labels', type: 'symbol', source: 'omt', 'source-layer': 'place', minzoom: 5,
        filter: ['in', ['get', 'class'], ['literal', ['city', 'town', 'village', 'suburb', 'neighbourhood']]],
        layout: { 'text-field': ['get', 'name'], 'text-font': ['Noto Sans Regular'], 'text-size': ['interpolate', ['linear'], ['zoom'], 7, 10, 15, 15] },
        paint: { 'text-color': c.label, 'text-halo-color': c.land, 'text-halo-width': 1.6 } },
      { id: 'road-labels', type: 'symbol', source: 'omt', 'source-layer': 'transportation_name', minzoom: 13,
        layout: { 'symbol-placement': 'line', 'text-field': ['get', 'name'], 'text-font': ['Noto Sans Regular'], 'text-size': ['interpolate', ['linear'], ['zoom'], 13, 11, 17, 14] },
        paint: { 'text-color': c.label, 'text-halo-color': c.land, 'text-halo-width': 1.6 } },
    ],
    glyphs: 'https://tiles.openfreemap.org/fonts/{fontstack}/{range}.pbf',
  };
}
