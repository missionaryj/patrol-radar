export type Status = 'dispatched' | 'enroute' | 'onscene' | 'clear' | 'unknown';
/** Output of the parser. Contains NO unit IDs, names or badge numbers. */
export interface ParsedEvent {
  callType: string;          // e.g. "traffic accident"
  location?: string;         // normalized address or "A & B" intersection
  status: Status;
  timestamp: number;
}
export interface GeoPoint { lat: number; lng: number; }
export interface Geocoder { geocode(location: string): Promise<GeoPoint | null>; }
/** An incident = call type + coarse area. Never a unit/officer position. */
export interface Incident {
  id: string;
  callType: string;
  cell: GeoPoint;            // coarsened
  firstSeen: number;
  lastUpdate: number;
  confidence: number;        // 0..1
  reports: number;
}
