import type { Scanner, AdvListener } from './types';
import { COMPANY_IDS } from './signatures';
import { normalizeEvent } from './normalize';
import { buildPoliceFilters, withoutManufacturerFilters } from './filters';
import { ScanError, classify } from './errors';

/**
 * Bluefy (iOS) backend. PASSIVE ONLY: never calls gatt.connect / pair / write.
 * Bluefy's in-app API reference documents only setScreenDimEnabled + 'backgroundstatechanged';
 * the "Enable BLE Advertisements" setting appears to enable the STANDARD per-device API:
 *   requestDevice({acceptAllDevices, optionalManufacturerData}) -> device.watchAdvertisements()
 *   -> 'advertisementreceived' on the device.
 * Each pick grants one device; the user can pick more (addDevice) and all are watched at once.
 * There is no all-devices scan on iOS, so this is a "watch the devices you pick" tool.
 */
export class BluefyScanner implements Scanner {
  readonly name = 'bluefy';
  mode = 'pick a device to watch';
  private bt: any = (navigator as any).bluetooth;
  private onAdv?: AdvListener;
  private watched = new Map<string, { dev: any; stop: () => void }>();
  onChange?: (n: number) => void;
  pickerMode: 'police' | 'all' = 'police';
  notice?: (msg: string) => void;

  async isSupported() { return !!this.bt && typeof this.bt.requestDevice === 'function'; }
  get count() { return this.watched.size; }

  async start(onAdv: AdvListener) {
    if (!window.isSecureContext) throw new ScanError('insecure', 'Page is not HTTPS; Web Bluetooth requires a secure context.');
    if (!this.bt) throw new ScanError('unsupported', 'No navigator.bluetooth. On iPhone, open this page in the Bluefy browser.');
    this.onAdv = onAdv;
    try { this.bt.setScreenDimEnabled?.(false); } catch { /* optional Bluefy API */ }
    await this.addDevice();
  }

  /** Opens the chooser; watches the picked device's advertisements. Must be called from a user tap. */
  async addDevice() {
    if (!this.onAdv) throw new ScanError('other', 'Not started');
    try {
      const dev = await this.request();
      if (this.watched.has(dev.id)) return;
      if (typeof dev.watchAdvertisements !== 'function')
        throw new ScanError('unsupported', 'API not found: device.watchAdvertisements is missing. See the API debug list below.');
      const onAdv = this.onAdv;
      const handler = (e: any) => { normalizeEvent(e).then(onAdv); };
      dev.addEventListener('advertisementreceived', handler);
      const ac = typeof AbortController !== 'undefined' ? new AbortController() : undefined;
      await dev.watchAdvertisements(ac ? { signal: ac.signal } : undefined);
      this.watched.set(dev.id, { dev, stop: () => { try { ac?.abort(); dev.unwatchAdvertisements?.(); } catch { /* */ } dev.removeEventListener('advertisementreceived', handler); } });
      this.onChange?.(this.watched.size);
      // Immediately classify from the name the picker returned (first advert will refine it).
      normalizeEvent({ device: dev, name: dev.name, rssi: undefined }).then(onAdv);
    } catch (e: any) {
      if (e?.name === 'NotFoundError' && this.pickerMode === 'police')
        throw new ScanError('permission', 'No police-type devices found nearby (or the list was cancelled). Try All devices.');
      throw classify(e);
    }
  }

  private async request() {
    if (this.pickerMode === 'all') return this.bt.requestDevice({ acceptAllDevices: true, optionalManufacturerData: COMPANY_IDS });
    const opts = buildPoliceFilters();
    try { return await this.bt.requestDevice(opts); }
    catch (e: any) {
      if (e?.name !== 'TypeError' && !(e instanceof TypeError)) throw e;
      this.notice?.('This browser rejected manufacturer-data filters; retrying with name/service filters only.');
      try { return await this.bt.requestDevice(withoutManufacturerFilters(opts)); }
      catch (e2: any) {
        if (e2?.name === 'TypeError' || e2 instanceof TypeError) throw new ScanError('unsupported', 'This browser rejected the police-gear filters. Switch the picker to All devices.');
        throw e2;
      }
    }
  }

  stop() {
    for (const w of this.watched.values()) w.stop();
    this.watched.clear(); this.onChange?.(0);
    try { this.bt?.setScreenDimEnabled?.(true); } catch { /* */ }
  }
}
