import type { Scanner, AdvListener } from './types';
import { COMPANY_IDS } from './signatures';
import { normalizeEvent } from './normalize';
import { ScanError, classify } from './errors';
import { findScanApis } from './probe';

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
      // 1. Any global scan/advert method (navigator.bluetooth, window.bluetooth, Bluefy globals).
      const apis = findScanApis(window);
      const global = apis.find(a => /^watchAdvertisements$/i.test(a.name)) ?? apis.find(a => /advert/i.test(a.name) && !/unwatch|stop/i.test(a.name));
      if (global) {
        this.mode = global.path;
        const tgt = global.obj;
        for (const t of new Set([tgt, this.bt])) { t?.addEventListener?.('advertisementreceived', handler); this.cleanup.push(() => t?.removeEventListener?.('advertisementreceived', handler)); }
        const ret = await tgt[global.name]({ acceptAllAdvertisements: true, keepRepeatedDevices: true, optionalManufacturerData: COMPANY_IDS }, handler);
        if (ret && typeof ret.stop === 'function') this.cleanup.push(() => ret.stop());
        if (typeof tgt.unwatchAdvertisements === 'function') this.cleanup.push(() => tgt.unwatchAdvertisements());
        return;
      }
      if (typeof this.bt.requestLEScan === 'function') {
        this.mode = 'navigator.bluetooth.requestLEScan';
        const scan = await this.bt.requestLEScan({ acceptAllAdvertisements: true, keepRepeatedDevices: true });
        this.bt.addEventListener('advertisementreceived', handler);
        this.cleanup.push(() => { scan.stop(); this.bt.removeEventListener('advertisementreceived', handler); });
        return;
      }
      // 2. Standard per-device API: requestDevice, then device.watchAdvertisements() (one device).
      const hasDeviceWatch = typeof (window as any).BluetoothDevice?.prototype?.watchAdvertisements === 'function';
      if (!hasDeviceWatch && typeof this.bt.requestDevice !== 'function')
        throw new ScanError('unsupported', 'No advertisement-scanning API found. See the API debug list below and send a screenshot.');
      this.mode = 'device.watchAdvertisements (single device)';
      const dev = await this.bt.requestDevice({ acceptAllDevices: true, optionalManufacturerData: COMPANY_IDS });
      if (typeof dev.watchAdvertisements !== 'function') throw new ScanError('unsupported', 'API not found: device.watchAdvertisements is missing. See the API debug list below.');
      dev.addEventListener('advertisementreceived', handler);
      const ac = new AbortController();
      await dev.watchAdvertisements({ signal: ac.signal });
      this.cleanup.push(() => { ac.abort(); dev.removeEventListener('advertisementreceived', handler); });
    } catch (e) { this.stop(); throw classify(e); }
  }
  stop() { for (const f of this.cleanup.splice(0)) { try { f(); } catch { /* ignore */ } } }
}
