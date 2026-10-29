/** Keeps the screen on while scanning, where the Screen Wake Lock API exists. Re-acquired after the tab is shown again. */
export class ScreenWake {
  private lock?: { release(): Promise<void>; released?: boolean; addEventListener?: (t: string, f: () => void) => void };
  private wanted = false;
  constructor(private nav: any = typeof navigator !== 'undefined' ? navigator : undefined) {
    if (typeof document !== 'undefined') document.addEventListener('visibilitychange', () => { if (this.wanted && document.visibilityState === 'visible') void this.acquire(); });
  }
  get supported() { return !!this.nav?.wakeLock?.request; }
  get held() { return !!this.lock && !this.lock.released; }
  async acquire(): Promise<boolean> {
    this.wanted = true; if (!this.supported) return false; if (this.held) return true;
    try { this.lock = await this.nav.wakeLock.request('screen'); return true; } catch { return false; }
  }
  async release() { this.wanted = false; const l = this.lock; this.lock = undefined; try { await l?.release(); } catch { /* already released */ } }
}
