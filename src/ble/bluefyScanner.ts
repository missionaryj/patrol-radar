import type { Scanner, AdvListener } from './types';
import { COMPANY_IDS } from './signatures';
import { normalizeEvent } from './normalize';
import { ScanError, classify } from './errors';

/**
 * Bluefy (iOS) backend. PASSIVE ONLY: never calls gatt.connect / pair / write.
 * Bluefy 3.8.2+ adds a proprietary `navigator.bluetooth.watchAdvertisements(options)` that
 * listens to adverts from surrounding devices (gated by Settings → "Enable BLE Advertisements").
 * Exact option/event shape isn't publicly documented outside the in-app API reference, so we:
 *   1. call bluetooth.watchAdvertisements({acceptAllAdvertisements:true}) and listen for
 *      'advertisementreceived' on navigator.bluetooth (and accept a callback/return-value variant);
 *   2. else requestLEScan if present;
 *   3. else per-device requestDevice + device.watchAdvertisements (one device only).
 * Events are normalised defensively (Map/object/array, numeric or hex keys).
 */
export class BluefyScanner implements Scanner {
  readonly name = 'bluefy';
  private cleanup: (() => void)[] = [];
  private bt: any = (navigator as any).bluetooth;
  mode = '';
  async isSupported() { return !!this.bt; }

  async start(onAdv: AdvListener) {
    if (!window.isSecureContext) throw new ScanError('insecure', 'Page is not HTTPS; Web Bluetooth requires a secure context.');
    if (!this.bt) throw new ScanError('unsupported', 'No navigator.bluetooth. On iPhone, open this page in the Bluefy browser.');
    const handler = (e: any) => { normalizeEvent(e).then(onAdv); };
    try {
      if (typeof this.bt.watchAdvertisements === 'function') {
        this.mode = 'bluefy-watchAdvertisements';
        this.bt.addEventListener?.('advertisementreceived', handler);
        this.cleanup.push(() => this.bt.removeEventListener?.('advertisementreceived', handler));
        const ret = await this.bt.watchAdvertisements({ acceptAllAdvertisements: true, keepRepeatedDevices: true, optionalManufacturerData: COMPANY_IDS }, handler);
        if (ret && typeof ret.stop === 'function') this.cleanup.push(() => ret.stop());
        this.cleanup.push(() => this.bt.unwatchAdvertisements?.());
        return;
      }
      if (typeof this.bt.requestLEScan === 'function') {
        this.mode = 'requestLEScan';
        const scan = await this.bt.requestLEScan({ acceptAllAdvertisements: true, keepRepeatedDevices: true });
        this.bt.addEventListener('advertisementreceived', handler);
        this.cleanup.push(() => { scan.stop(); this.bt.removeEventListener('advertisementreceived', handler); });
        return;
      }
      if (/iPhone|iPad|bluefy/i.test(navigator.userAgent))
        throw new ScanError('adv-disabled', 'Advertisement scanning is off. In Bluefy open Settings and turn on "Enable BLE Advertisements", then reload this page.');
      this.mode = 'device.watchAdvertisements (single device)';
      const dev = await this.bt.requestDevice({ acceptAllDevices: true, optionalManufacturerData: COMPANY_IDS });
      if (typeof dev.watchAdvertisements !== 'function') throw new ScanError('unsupported', 'watchAdvertisements not supported.');
      dev.addEventListener('advertisementreceived', handler);
      const ac = new AbortController();
      await dev.watchAdvertisements({ signal: ac.signal });
      this.cleanup.push(() => { ac.abort(); dev.removeEventListener('advertisementreceived', handler); });
    } catch (e) { this.stop(); throw classify(e); }
  }
  stop() { for (const f of this.cleanup.splice(0)) { try { f(); } catch { /* ignore */ } } }
}
