export interface Report {
  id: string;
  category: string;
  label: string;
  confidence: number;
  lat: number; lng: number;   // already coarsened
  timestamp: number;          // ms
  /** Which radio produced it (Wi-Fi reports draw with a blue dashed ring). Optional for older stored reports. */
  radio?: 'ble' | 'wifi';
}
/** Future crowdsourced backend. NOT implemented. A real one must aggregate, coarsen and delay data and never identify officers. */
export interface ReportBackend {
  submit(r: Report): Promise<void>;
  fetchNearby(lat: number, lng: number, radiusKm: number): Promise<Report[]>;
}
export class NotImplementedBackend implements ReportBackend {
  async submit() { throw new Error('No shared backend: local-only build.'); }
  async fetchNearby() { return []; }
}
