/**
 * Detects a stalled web scan: no adverts for STALL_MS while running, or the page was hidden
 * (tab backgrounded / screen locked), which silently suspends Web Bluetooth scanning.
 * Pure logic + timers; the UI decides how to warn and restart.
 */
export const STALL_MS = 20_000;
export type StallReason = 'no-adverts' | 'hidden' | 'resumed';
export class StallWatchdog {
  private lastAdvert = 0; private startedAt = 0; private running = false; private fired = false; private hiddenAt?: number;
  private timer?: ReturnType<typeof setInterval>;
  constructor(private onStall: (reason: StallReason, idleMs: number) => void, private stallMs = STALL_MS, private now = () => Date.now()) {}
  start() { this.running = true; this.fired = false; this.startedAt = this.lastAdvert = this.now(); this.hiddenAt = undefined; this.timer ??= setInterval(() => this.check(), 2000); }
  stop() { this.running = false; if (this.timer) clearInterval(this.timer); this.timer = undefined; }
  advert() { this.lastAdvert = this.now(); this.fired = false; }
  /** Call on visibilitychange. Hidden => warn now; visible again => ask the UI to restart. */
  visibility(hidden: boolean) {
    if (!this.running) return;
    if (hidden) { this.hiddenAt = this.now(); this.onStall('hidden', 0); }
    else if (this.hiddenAt !== undefined) { const gone = this.now() - this.hiddenAt; this.hiddenAt = undefined; this.fired = false; this.onStall('resumed', gone); }
  }
  check() {
    if (!this.running || this.fired || this.hiddenAt !== undefined) return;
    const idle = this.now() - this.lastAdvert;
    if (idle >= this.stallMs) { this.fired = true; this.onStall('no-adverts', idle); }
  }
}
