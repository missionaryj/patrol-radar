import type { Scanner, AdvListener } from './types';
import { COMPANY_IDS } from './signatures';
import { ephemeralId } from '../util/hash';

/**
 * PASSIVE ONLY. Uses advertisement events; never calls gatt.connect(), never pairs/writes.
 * requestLEScan: Chrome behind chrome://flags/#enable-experimental-web-platform-features
 * (Android/desktop, HTTPS or localhost). Fallback: requestDevice({acceptAllDevices}) + watchAdvertisements()
 * on the single user-chosen device; we filter manufacturer data client-side (acceptAllDevices
 * cannot be combined with filters, so optionalManufacturerData exposes the company IDs).
 */
export class WebBluetoothScanner implements Scanner {
  readonly name = 'web-bluetooth';
  private scan?: { stop(): void; active: boolean };
  private handler?: (e: Event) => void;
  private dev?: any;
  private bt = (navigator as any).bluetooth;

  async isSupported() { return !!this.bt && (await this.bt.getAvailability?.().catch(() => false)) !== false; }

  async start(onAdv: AdvListener) {
    this.handler = async (e: any) => {
      const serviceData = new Map<string, DataView>();
      e.serviceData?.forEach((v: DataView, k: string) => serviceData.set(k, v));
      const manufacturerData = new Map<number, DataView>();
      e.manufacturerData?.forEach((v: DataView, k: number) => manufacturerData.set(k, v));
      onAdv({ sessionId: await ephemeralId(e.device?.id ?? 'unknown'), name: e.name ?? e.device?.name, rssi: e.rssi,
        manufacturerData, serviceUuids: e.uuids ?? [], serviceData, timestamp: Date.now() });
    };
    if (typeof this.bt.requestLEScan === 'function') {
      this.scan = await this.bt.requestLEScan({ acceptAllAdvertisements: true, keepRepeatedDevices: true });
      this.bt.addEventListener('advertisementreceived', this.handler);
      return;
    }
    // Fallback: one user-picked device; only advertisements are watched, no GATT connection.
    this.dev = await this.bt.requestDevice({ acceptAllDevices: true, optionalManufacturerData: COMPANY_IDS });
    if (typeof this.dev.watchAdvertisements !== 'function') throw new Error('watchAdvertisements unsupported; enable experimental web platform features flag.');
    this.dev.addEventListener('advertisementreceived', this.handler);
    await this.dev.watchAdvertisements();
  }

  stop() {
    this.scan?.stop();
    if (this.handler) { this.bt?.removeEventListener('advertisementreceived', this.handler); this.dev?.removeEventListener('advertisementreceived', this.handler); }
    this.dev = undefined;
  }
}
