import { MOCK_FEED } from './fixtures/transcripts';
import { parseTranscript } from './parser';
import { MockGeocoder } from './geocoder';
import { IncidentMerger } from './incidentMerger';
import { coarsenPoint } from './privacy';
import type { Incident } from './types';

/** Simulates the pipeline: transcript -> parse(scrub) -> geocode -> coarsen -> merge. Transcript is discarded after parsing.
 *  Local demo shows incidents immediately (labelled "demo, undelayed"); shared output must go through publishable(). */
export function startMockRadioFeed(onUpdate: (incs: Incident[]) => void, intervalMs = 2500) {
  const geo = new MockGeocoder(); const merger = new IncidentMerger(); let i = 0;
  const t = setInterval(async () => {
    const ev = parseTranscript(MOCK_FEED[i++ % MOCK_FEED.length]);
    if (!ev?.location) return;
    const p = await geo.geocode(ev.location); if (!p) return;
    merger.add(ev, coarsenPoint(p)); merger.expire(Date.now()); onUpdate(merger.list());
  }, intervalMs);
  return () => clearInterval(t);
}
