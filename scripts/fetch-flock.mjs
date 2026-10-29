#!/usr/bin/env node
// Exports US Flock ALPR nodes from OpenStreetMap (Overpass API) to public/data/flock-us.geojson.
// Data © OpenStreetMap contributors, ODbL 1.0 (https://www.openstreetmap.org/copyright). Same source DeFlock.me maps.
// Usage: node scripts/fetch-flock.mjs [--endpoint URL]
import { writeFileSync, mkdirSync, rmSync, readFileSync } from 'node:fs';
const ep = process.argv.includes('--endpoint') ? process.argv[process.argv.indexOf('--endpoint') + 1] : 'https://overpass-api.de/api/interpreter';
const query = `[out:json][timeout:600];
area["ISO3166-1"="US"][admin_level=2]->.us;
( node["surveillance:type"="ALPR"]["manufacturer"~"flock",i](area.us);
  node["surveillance:type"="ALPR"]["brand"~"flock",i](area.us); );
out body;`;
export function toGeoJSON(osm) {
  const features = osm.elements.filter(e => e.type === 'node').map(e => ({
    type: 'Feature', geometry: { type: 'Point', coordinates: [+e.lon.toFixed(4), +e.lat.toFixed(4)] },
    properties: { id: e.id, ...(e.tags?.direction ? { dir: e.tags.direction } : e.tags?.['camera:direction'] ? { dir: e.tags['camera:direction'] } : {}) },
  }));
  return { type: 'FeatureCollection', attribution: '© OpenStreetMap contributors (ODbL)', source: 'OpenStreetMap via Overpass API', osm_base: osm.osm3s?.timestamp_osm_base ?? null, generated: new Date().toISOString(), count: features.length, features };
}
/** Splits into TILE_DEG x TILE_DEG GeoJSON tiles + index.json so the app only loads tiles in view. */
export const TILE_DEG = 5;
export const tileKey = (lat, lng) => `${Math.floor(lat / TILE_DEG) * TILE_DEG}_${Math.floor(lng / TILE_DEG) * TILE_DEG}`;
export function writeTiles(gj, dir) {
  rmSync(dir, { recursive: true, force: true }); mkdirSync(dir, { recursive: true });
  const tiles = {};
  for (const f of gj.features) { const [lng, lat] = f.geometry.coordinates; (tiles[tileKey(lat, lng)] ??= []).push(f); }
  for (const [k, fs] of Object.entries(tiles)) writeFileSync(`${dir}/${k}.geojson`, JSON.stringify({ type: 'FeatureCollection', features: fs }));
  const { features, ...meta } = gj;
  writeFileSync(`${dir}/index.json`, JSON.stringify({ ...meta, tileDeg: TILE_DEG, tiles: Object.fromEntries(Object.entries(tiles).map(([k, v]) => [k, v.length])) }));
}
if (process.argv[2] === '--retile') { const gj = JSON.parse(readFileSync(process.argv[3], 'utf8')); writeTiles(gj, 'public/data/flock'); console.log('retiled', gj.count); }
else if (import.meta.url === `file://${process.argv[1]}`) {
  const res = await fetch(ep, { method: 'POST', body: new URLSearchParams({ data: query }), headers: { 'User-Agent': 'patrol-radar-flock-export/1.0 (github.com/missionaryj/patrol-radar)' } });
  if (!res.ok) { console.error('Overpass error', res.status, await res.text()); process.exit(1); }
  const gj = toGeoJSON(await res.json());
  writeTiles(gj, 'public/data/flock');
  console.log(`wrote ${gj.count} nodes, osm_base ${gj.osm_base}`);
}
