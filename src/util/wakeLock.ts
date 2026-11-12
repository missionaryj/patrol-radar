/** Keeps the screen on while scanning, where the Screen Wake Lock API exists. Re-acquired after the tab is shown again. */
export class ScreenWake {
  private lock?: { release(): Promise<void>; released?: boolean; addEventListener?: (t: string, f: () => void) => void };
  private wanted = false;
  private generation = 0;
  constructor(private nav: any = typeof navigator !== 'undefined' ? navigator : undefined) {
    if (typeof document !== 'undefined') document.addEventListener('visibilitychange', () => { if (this.wanted && document.visibilityState === 'visible') void this.acquire(); });
  }
  get supported() { return !!this.nav?.wakeLock?.request; }
  get held() { return !!this.lock && !this.lock.released; }
  async acquire(): Promise<boolean> {
    this.wanted = true; if (!this.supported) return false; if (this.held) return true;
    const generation = this.generation;
    try {
      const lock = await this.nav.wakeLock.request('screen');
      if (generation !== this.generation || !this.wanted) { await lock.release(); return false; }
      this.lock = lock; return true;
    } catch { return false; }
  }
  async release() { ++this.generation; this.wanted = false; const l = this.lock; this.lock = undefined; try { await l?.release(); } catch { /* already released */ } }
}
