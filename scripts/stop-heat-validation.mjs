import polygonClipping from 'polygon-clipping';
import { GRID_M, partsFromDate, snap } from './stop-heat-lib.mjs';
export function number(value) {
    if (value == null || String(value).trim() === '')
        return null;
    const n = Number(value);
    return Number.isFinite(n) ? n : null;
}
// A latitude index avoids scanning detailed Census coastlines for every stop.
// Even/odd crossings retain islands and holes; boundary points are accepted.
export function jurisdictionContains(geometry) {
    const polygons = geometry.type === 'Polygon' ? [geometry.coordinates] : geometry.coordinates;
    if (geometry.type !== 'Polygon' && geometry.type !== 'MultiPolygon')
        throw Error('Polygon required');
    const bins = new Map(), step = 0.01;
    for (const polygon of polygons)
        for (const ring of polygon) {
            for (let i = 1; i < ring.length; i++) {
                const a = ring[i - 1], b = ring[i];
                for (let y = Math.floor(Math.min(a[1], b[1]) / step); y <= Math.floor(Math.max(a[1], b[1]) / step); y++) {
                    if (!bins.has(y))
                        bins.set(y, []);
                    bins.get(y).push([a, b]);
                }
            }
        }
    return (lng, lat) => {
        if (!Number.isFinite(lng) || !Number.isFinite(lat))
            return false;
        let inside = false;
        for (const [[ax, ay], [bx, by]] of bins.get(Math.floor(lat / step)) ?? []) {
            const cross = (lng - ax) * (by - ay) - (lat - ay) * (bx - ax);
            if (Math.abs(cross) < 1e-12 && lng >= Math.min(ax, bx) && lng <= Math.max(ax, bx) && lat >= Math.min(ay, by) && lat <= Math.max(ay, by))
                return true;
            if ((ay > lat) !== (by > lat) && lng < (bx - ax) * (lat - ay) / (by - ay) + ax)
                inside = !inside;
        }
        return inside;
    };
}
export function cellPolygon(lat, lng) {
    const dy = GRID_M / 111320 / 2, dx = GRID_M / (111320 * Math.cos(lat * Math.PI / 180)) / 2;
    return [[[lng - dx, lat - dy], [lng + dx, lat - dy], [lng + dx, lat + dy], [lng - dx, lat + dy], [lng - dx, lat - dy]]];
}
// Spherical polygon area (WGS84 authalic radius). This is a coarse occupied
// cell footprint, not the area of the jurisdiction and not road coverage.
export function geometryArea(polygons) {
    const rad = Math.PI / 180, R = 6371007.1809;
    const ringArea = ring => {
        let a = 0;
        for (let i = 1; i < ring.length; i++)
            a += (ring[i][0] - ring[i - 1][0]) * rad * (2 + Math.sin(ring[i - 1][1] * rad) + Math.sin(ring[i][1] * rad));
        return Math.abs(a * R * R / 2);
    };
    return polygons.reduce((sum, p) => sum + ringArea(p[0]) - p.slice(1).reduce((s, r) => s + ringArea(r), 0), 0);
}
export function occupiedArea(cells, geometries) {
    const shapes = geometries.map(g => g.type === 'Polygon' ? [g.coordinates] : g.coordinates);
    const union = shapes.length === 1 ? shapes[0] : polygonClipping.union(...shapes);
    let area = 0;
    const tiles = new Map();
    for (const [lat, lng] of cells.values()) {
        const x = Math.floor(lng / 0.25) * 0.25, y = Math.floor(lat / 0.25) * 0.25, key = `${x},${y}`;
        if (!tiles.has(key))
            tiles.set(key, polygonClipping.intersection(union, [[[x - 0.01, y - 0.01], [x + 0.26, y - 0.01], [x + 0.26, y + 0.26], [x - 0.01, y + 0.26], [x - 0.01, y - 0.01]]]));
        const clipped = tiles.get(key);
        if (clipped.length)
            area += geometryArea(polygonClipping.intersection([cellPolygon(lat, lng)], clipped));
    }
    return area;
}
export class StopValidator {
    constructor({ contains, start, end, asOf, placement = 'point' }) {
        this.contains = contains;
        this.start = start;
        this.end = end;
        this.asOf = asOf;
        // 'city' counts an official stop on a source-owned boundary when the
        // file has a location code and no coordinates. It never invents a point.
        this.placement = placement === 'city' ? 'city' : 'point';
        this.events = new Map();
        this.conflicts = new Set();
        this.seen = 0;
        this.rejected = {};
        this.duplicates = 0;
        this.minDate = null;
        this.maxDate = null;
        this.cells = new Map();
    }
    reject(reason, n = 1) { this.rejected[reason] = (this.rejected[reason] ?? 0) + n; }
    add(row) {
        this.seen++;
        if (!row.vehicle)
            return this.reject('not_vehicle');
        const parts = partsFromDate(row.date);
        if (!/^\d{4}-\d{2}-\d{2}$/.test(row.date) || !parts || row.date < this.start || row.date > this.end || row.date > this.asOf)
            return this.reject('invalid_date');
        const city = this.placement === 'city';
        let lat = null, lng = null;
        if (city) {
            // A geocode is not a coordinate and is not drawn. Unknown codes drop.
            if (!row.locationCode)
                return this.reject('unknown_location');
        } else {
            lat = number(row.lat);
            lng = number(row.lng);
            if (lat === null || lng === null || lat < -90 || lat > 90 || lng < -180 || lng > 180 || (lat === 0 && lng === 0))
                return this.reject('missing_or_invalid_coordinates');
            if (!this.contains(lng, lat))
                return this.reject('outside_jurisdiction');
        }
        if (!String(row.key ?? '').trim())
            return this.reject('missing_event_key');
        if (this.conflicts.has(row.key))
            return this.reject('conflicting_event');
        const prior = this.events.get(row.key);
        if (prior) {
            // Inconsistent event identity must never silently choose a location.
            const samePlace = city ? prior.locationCode === row.locationCode : prior.lat === lat && prior.lng === lng;
            if (prior.date !== row.date || prior.time !== row.time || !samePlace) {
                this.events.delete(row.key);
                this.conflicts.add(row.key);
                this.duplicates -= prior.rows - 1;
                return this.reject('conflicting_event', prior.rows + 1);
            }
            this.duplicates++;
            prior.rows++;
            prior.cite ||= row.cite;
            prior.warn ||= row.warn;
            prior.arrest ||= row.arrest;
            if (prior.reason !== row.reason)
                prior.reason = null;
            return;
        }
        // Deliberate allow-list: source event keys are retained only in memory.
        this.events.set(row.key, { date: row.date, time: row.time, lat, lng, locationCode: city ? row.locationCode : undefined, ...parts, hour: row.hour, cite: row.cite, warn: row.warn, arrest: row.arrest, reason: row.reason, rows: 1 });
    }
    report() {
        this.minDate = null;
        this.maxDate = null;
        this.cells.clear();
        for (const row of this.events.values()) {
            this.minDate = this.minDate === null || row.date < this.minDate ? row.date : this.minDate;
            this.maxDate = this.maxDate === null || row.date > this.maxDate ? row.date : this.maxDate;
            if (!Number.isFinite(row.lat) || !Number.isFinite(row.lng))
                continue;
            const p = snap(row.lat, row.lng);
            this.cells.set(`${p.lat},${p.lng}`, [p.lat, p.lng]);
        }
        const rejected = Object.values(this.rejected).reduce((a, b) => a + b, 0);
        if (this.seen !== this.events.size + rejected + this.duplicates)
            throw Error('Row reconciliation failed');
        return { seen: this.seen, accepted: this.events.size, duplicate_rows: this.duplicates, rejected, rejection_reasons: this.rejected, time_range: [this.minDate, this.maxDate] };
    }
}
