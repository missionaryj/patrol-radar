import { CHAMPAIGN_MOCK_FEED } from './fixtures/champaign';
import { LocalLookupGeocoder, MockGeocoder, ChainGeocoder } from './geocoder';
import { DispatchPipeline } from './pipeline';
import { MockTranscriptSource, ChampaignArcgisReplaySource } from './sources';
import type { Incident } from './types';

export type RadioSourceKind = 'mock' | 'champaign-replay';
/** Runs the dispatch pipeline. Mock transcripts are back-dated 40 min so the 12-min delay gate releases them right away. */
export function startRadio(kind: RadioSourceKind, onUpdate: (incs: Incident[], pending: number) => void) {
  const geo = new ChainGeocoder([new LocalLookupGeocoder(), new MockGeocoder()]);
  const p: DispatchPipeline = new DispatchPipeline(geo, incs => onUpdate(incs, p.pending()));
  p.add(kind === 'mock' ? new MockTranscriptSource(CHAMPAIGN_MOCK_FEED, 700) : new ChampaignArcgisReplaySource());
  const tick = setInterval(() => p.emit(), 30_000);
  return () => { clearInterval(tick); p.stop(); };
}
export function startMockRadioFeed(onUpdate: (incs: Incident[]) => void) { return startRadio('mock', i => onUpdate(i)); }
