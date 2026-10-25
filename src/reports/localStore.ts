import type { Report } from './types';
const KEY = 'patrol-radar.reports';
export const TTL_MS = 15 * 60 * 1000; // detections expire after 15 min

export class LocalReportStore {
  list(now = Date.now()): Report[] {
    const all: Report[] = JSON.parse(localStorage.getItem(KEY) ?? '[]');
    const live = all.filter(r => now - r.timestamp < TTL_MS);
    if (live.length !== all.length) this.save(live);
    return live;
  }
  add(r: Report) { this.save([...this.list(), r].slice(-500)); }
  clear() { localStorage.removeItem(KEY); }
  private save(rs: Report[]) { localStorage.setItem(KEY, JSON.stringify(rs)); }
}
