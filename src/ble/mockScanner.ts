import type { Scanner, AdvListener, Advertisement } from './types';
import { ephemeralId } from '../util/hash';

const dv = (bytes: number[]) => new DataView(new Uint8Array(bytes).buffer);
const enc = (s: string) => [...new TextEncoder().encode(s)];
const U = (u: number) => `0000${u.toString(16).padStart(4, '0')}-0000-1000-8000-00805f9b34fb`;

type Template = Omit<Advertisement, 'sessionId' | 'timestamp' | 'rssi'>;
const TEMPLATES: Template[] = [
  { name: undefined, manufacturerData: new Map([[0x034d, dv([1, 2, 3])]]), serviceUuids: [U(0xfc81)], serviceData: new Map() },
  { name: undefined, manufacturerData: new Map(), serviceUuids: [], serviceData: new Map([[U(0xfe6c), dv(enc('BWCDEVICE'))]]) },
  { name: 'BodyWorn Remote', manufacturerData: new Map(), serviceUuids: [], serviceData: new Map() },
  { name: 'Some Headphones', manufacturerData: new Map([[0x004c, dv([0])]]), serviceUuids: [], serviceData: new Map() }, // noise
  { name: undefined, manufacturerData: new Map([[0x04ec, dv([9])]]), serviceUuids: [], serviceData: new Map() },
];

/** Emits simulated advertisements. Default backend. */
export class MockScanner implements Scanner {
  readonly name = 'mock';
  private timer?: number;
  async isSupported() { return true; }
  async start(onAdv: AdvListener) {
    this.timer = window.setInterval(async () => {
      const i = Math.floor(Math.random() * TEMPLATES.length);
      onAdv({ ...TEMPLATES[i], sessionId: await ephemeralId('mock-device-' + i), rssi: -40 - Math.round(Math.random() * 60), timestamp: Date.now() });
    }, 1500);
  }
  stop() { clearInterval(this.timer); }
}
