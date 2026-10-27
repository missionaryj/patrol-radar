/**
 * "Police ping" audio alert. Plays when a NEW police-gear match first appears on the map.
 * - Only signature matches (never phones / consumer / unmatched devices).
 * - Once per device (session-hashed key) per session, and once per coarse cell per CELL_MS.
 * - Global cooldown so a cluster of gear doesn't spam.
 * - Fixed infrastructure (Flock ALPR / Raven) gets a soft ping (lower volume), same rules.
 */
export const COOLDOWN_MS = 45_000;
export const CELL_MS = 10 * 60_000;
export type PingLevel = 'normal' | 'soft';

export class PingGate {
  private devices = new Set<string>();
  private cells = new Map<string, number>();
  private last = -Infinity;
  constructor(private cooldownMs = COOLDOWN_MS, private cellMs = CELL_MS) {}
  /** Returns the ping level to play, or null. Records the device either way so a device only ever gets one chance. */
  check(i: { deviceKey: string; cell: string; category: string; matched: boolean }, now = Date.now()): PingLevel | null {
    if (!i.matched) return null;
    if (this.devices.has(i.deviceKey)) return null;
    this.devices.add(i.deviceKey);
    const c = this.cells.get(i.cell);
    if (c !== undefined && now - c < this.cellMs) return null;
    if (now - this.last < this.cooldownMs) return null;
    this.last = now; this.cells.set(i.cell, now);
    return i.category === 'fixed' ? 'soft' : 'normal';
  }
  reset() { this.devices.clear(); this.cells.clear(); this.last = -Infinity; }
}

const KEY = 'pr.sound';
export const soundEnabled = () => { try { return localStorage.getItem(KEY) !== 'off'; } catch { return true; } };
export const setSoundEnabled = (on: boolean) => { try { localStorage.setItem(KEY, on ? 'on' : 'off'); } catch { /* ignore */ } };

/** Audio player. Must be unlocked from a user gesture (Start scan / toggle) because of autoplay rules. */
export class PingPlayer {
  private ctx?: AudioContext; private buf?: AudioBuffer; private el?: HTMLAudioElement;
  constructor(private url = new URL('sounds/police-ping.mp3', document.baseURI.replace(/v2\/?[^/]*$/, '')).href) {}
  async unlock() {
    try {
      const AC = (window as any).AudioContext || (window as any).webkitAudioContext;
      if (AC && !this.ctx) this.ctx = new AC();
      await this.ctx?.resume();
      if (this.ctx && !this.buf) { const r = await fetch(this.url); this.buf = await this.ctx.decodeAudioData(await r.arrayBuffer()); }
    } catch { this.el ??= new Audio(this.url); }
  }
  play(level: PingLevel = 'normal') {
    const vol = level === 'soft' ? 0.35 : 1;
    (window as any).__pingCount = ((window as any).__pingCount ?? 0) + 1; // for demo/test capture
    if (this.ctx && this.buf && this.ctx.state === 'running') {
      const s = this.ctx.createBufferSource(), g = this.ctx.createGain(); g.gain.value = vol;
      s.buffer = this.buf; s.connect(g).connect(this.ctx.destination); s.start(); return;
    }
    const a = this.el ?? new Audio(this.url); a.volume = vol; a.currentTime = 0; void a.play().catch(() => {});
  }
}
