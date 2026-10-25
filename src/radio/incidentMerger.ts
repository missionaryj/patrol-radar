import type { Incident, ParsedEvent, GeoPoint } from './types';
const STATUS_BOOST = { dispatched: 0.5, enroute: 0.1, onscene: 0.2, clear: 0, unknown: 0.05 } as const;

/** Merges events into incidents by coarse cell + call type + time window. "onscene" only boosts confidence/updates time. */
export class IncidentMerger {
  private incidents: Incident[] = [];
  constructor(private windowMs = 30 * 60_000) {}
  add(ev: ParsedEvent, cell: GeoPoint): Incident {
    const near = (a: GeoPoint) => Math.abs(a.lat - cell.lat) < 1e-6 && Math.abs(a.lng - cell.lng) < 1e-6;
    let inc = this.incidents.find(i => near(i.cell) && ev.timestamp - i.lastUpdate <= this.windowMs &&
      (i.callType === ev.callType || ev.callType === 'unknown' || i.callType === 'unknown'));
    if (!inc) {
      inc = { id: crypto.randomUUID(), callType: ev.callType, cell, firstSeen: ev.timestamp, lastUpdate: ev.timestamp, confidence: 0, reports: 0 };
      this.incidents.push(inc);
    }
    if (inc.callType === 'unknown' && ev.callType !== 'unknown') inc.callType = ev.callType;
    inc.reports++;
    inc.lastUpdate = Math.max(inc.lastUpdate, ev.timestamp);
    inc.confidence = +Math.min(0.95, inc.confidence + STATUS_BOOST[ev.status] * (1 - inc.confidence)).toFixed(3);
    return inc;
  }
  expire(now: number) { this.incidents = this.incidents.filter(i => now - i.lastUpdate <= this.windowMs * 2); }
  list() { return [...this.incidents]; }
}
