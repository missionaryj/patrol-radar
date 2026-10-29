import type { Scanner, AdvListener } from '../ble/types';
import { StallWatchdog, type StallReason } from '../ble/stallWatchdog';
import { ScreenWake } from '../util/wakeLock';
import type { SessionRecorder } from '../recorder/recorder';

/**
 * Web scan supervisor: stall warning + auto-restart (same scanner, same session salt) and a screen wake lock.
 * Only the open Web Bluetooth scan ('web') gets stall detection: Bluefy watches single devices and the Android
 * backend uses hardware filters, so silence is normal there. The wake lock is used for every backend.
 */
export class ScanSupervisor {
  readonly wake = new ScreenWake();
  private dog: StallWatchdog; private scanner?: Scanner; private cb?: AdvListener; private kind = ''; private restarting = false;
  constructor(private o: { warn: (msg: string, err?: boolean) => void; recorder: SessionRecorder; onWake?: (held: boolean) => void }) {
    this.dog = new StallWatchdog((r, ms) => void this.stalled(r, ms));
    if (typeof document !== 'undefined') document.addEventListener('visibilitychange', () => this.dog.visibility(document.visibilityState === 'hidden'));
  }
  async started(kind: string, scanner: Scanner, cb: AdvListener) {
    this.kind = kind; this.scanner = scanner; this.cb = cb;
    if (kind === 'web') this.dog.start();
    this.o.onWake?.(await this.wake.acquire());
  }
  stopped() { this.dog.stop(); this.scanner = undefined; this.cb = undefined; void this.wake.release(); this.o.onWake?.(false); }
  advert() { this.dog.advert(); }
  private async stalled(reason: StallReason, ms: number) {
    if (!this.scanner || !this.cb) return;
    if (reason === 'hidden') { this.o.recorder.event('stall', this.kind, 'page hidden / screen locked'); this.o.warn('Scan paused: the screen locked or the tab went to the background. It restarts when you come back.', true); return; }
    this.o.recorder.event('stall', this.kind, reason === 'resumed' ? `resumed after ${Math.round(ms / 1000)} s hidden` : `no adverts for ${Math.round(ms / 1000)} s`);
    if (reason === 'no-adverts') this.o.warn(`Scan stalled: no Bluetooth adverts for ${Math.round(ms / 1000)} s. Restarting…`, true);
    await this.restart();
  }
  /** Restarts the same scanner object (keeps the session salt). Chrome may require a tap; then we ask for one. */
  async restart(): Promise<boolean> {
    if (this.restarting || !this.scanner || !this.cb) return false; this.restarting = true;
    try { this.scanner.stop(); await this.scanner.start(this.cb); this.dog.advert(); this.o.recorder.event('auto-restart', this.kind); this.o.warn('Scan restarted.'); return true; }
    catch (e) { this.o.recorder.event('error', this.kind, `auto-restart failed: ${(e as Error)?.message ?? e}`); this.o.warn('Scan stalled and the browser blocked an automatic restart. Tap anywhere on the map to resume.', true); this.armTapResume(); return false; }
    finally { this.restarting = false; }
  }
  private armTapResume() { if (typeof document === 'undefined') return; document.addEventListener('pointerdown', () => void this.restart(), { once: true, capture: true }); }
}
