import type { Geocoder, Incident } from './types';
import type { IncidentSource, SourceEvent } from './sources';
import { parseTranscript } from './parser';
import { IncidentMerger } from './incidentMerger';
import { coarsenPoint, publishable, DEFAULT_PRIVACY, type PrivacyConfig } from './privacy';
import { redact } from './redact';

/** source -> (STT) -> redact+parse -> geocode -> coarsen -> merge -> delay gate -> pins.
 *  Transcript text lives only inside handle(); nothing retains it. Only the delayed list is ever exposed. */
export class DispatchPipeline {
  private merger = new IncidentMerger(); private stops: (() => void)[] = [];
  stats = { received: 0, parsed: 0, geocoded: 0, dropped: 0 };
  constructor(private geocoder: Geocoder, private onUpdate: (incs: Incident[]) => void = () => {}, private privacy: PrivacyConfig = DEFAULT_PRIVACY, private now = () => Date.now()) {}
  add(src: IncidentSource) { this.stops.push(src.start(e => { void this.handle(e); })); return this; }
  stop() { this.stops.forEach(s => s()); this.stops = []; }
  async handle(e: SourceEvent) {
    this.stats.received++;
    let ev; let fixed: { lat: number; lng: number } | undefined;
    if (e.kind === 'transcript') { ev = parseTranscript(e.t.text, e.t.timestamp); /* e.t.text is dropped here */ }
    else {
      const c = e.c; ev = { callType: redact(c.callType).toLowerCase(), location: c.location, status: c.status ?? 'dispatched', timestamp: c.timestamp } as const;
      if (c.lat != null && c.lng != null) fixed = { lat: c.lat, lng: c.lng };
    }
    if (!ev?.location) { this.stats.dropped++; return; }
    this.stats.parsed++;
    const p = fixed ?? await this.geocoder.geocode(ev.location); if (!p) { this.stats.dropped++; return; }
    this.stats.geocoded++;
    this.merger.add({ ...ev, location: undefined }, coarsenPoint(p, this.privacy.gridMeters));
    this.merger.expire(this.now()); this.emit();
  }
  /** Only incidents past the publish delay (>=10 min, 12 default). */
  visible() { return publishable(this.merger.list(), this.now(), this.privacy); }
  pending() { return this.merger.list().length - this.visible().length; }
  emit() { this.onUpdate(this.visible()); }
}
