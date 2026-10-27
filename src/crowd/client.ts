import { buildReport, newReporterToken, type CrowdCell, type CrowdReport } from './protocol';
export const CROWD_API = 'https://patrol-radar-api.vercel.app/api/crowd';
const PREF = 'pr.crowd.share';
/** Opt-in sharing (off by default). The reporter token is random, kept in memory only, and rotates every session/page load. */
export class CrowdClient {
  private reporter = newReporterToken();
  private sent = new Set<string>();
  constructor(private api = CROWD_API, private fetchFn: typeof fetch = (...a) => fetch(...a)) {}
  get sharing() { return localStorage.getItem(PREF) === '1'; }
  set sharing(on: boolean) { localStorage.setItem(PREF, on ? '1' : '0'); if (!on) this.rotate(); }
  rotate() { this.reporter = newReporterToken(); this.sent.clear(); }
  /** Returns the payload sent (or null if not sharing / duplicate). Location is snapped to the grid before it leaves. */
  async report(m: { kind: string; confidence: number; time: number }, loc: { lat: number; lng: number }): Promise<CrowdReport | null> {
    if (!this.sharing) return null;
    const p = buildReport({ ...loc, ...m, reporter: this.reporter });
    const k = `${p.cell.lat},${p.cell.lng},${p.bucket},${p.kind},${p.conf}`;
    if (this.sent.has(k)) return null; this.sent.add(k);
    try { await this.fetchFn(this.api, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(p), credentials: 'omit', referrerPolicy: 'no-referrer' }); } catch { this.sent.delete(k); }
    return p;
  }
  async cells(): Promise<CrowdCell[]> {
    const r = await this.fetchFn(this.api, { credentials: 'omit', referrerPolicy: 'no-referrer' }); if (!r.ok) throw new Error(`HTTP ${r.status}`);
    return ((await r.json()) as { cells: CrowdCell[] }).cells;
  }
}
