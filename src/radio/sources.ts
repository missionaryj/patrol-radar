/** Pluggable inputs. A source emits either raw transcripts (after STT) or structured CAD-like events.
 *  Transcripts are passed by value to the pipeline, which parses and immediately drops them. */
export interface RawTranscript { text: string; timestamp: number; feed: string; }
export interface StructuredCall { callType: string; location: string; timestamp: number; status?: 'dispatched' | 'onscene'; feed: string; lat?: number; lng?: number; }
export type SourceEvent = { kind: 'transcript'; t: RawTranscript } | { kind: 'structured'; c: StructuredCall };
export interface IncidentSource { readonly name: string; start(emit: (e: SourceEvent) => void): () => void; }

/** Audio chunk from a licensed/own-SDR feed (e.g. trunk-recorder call WAV). */
export interface AudioChunk { audio: ArrayBuffer | Blob; mime: string; timestamp: number; feed: string; talkgroup?: number; }
export interface SpeechToText { readonly name: string; transcribe(chunk: AudioChunk): Promise<string>; }

/** Mock STT: the "audio" is UTF-8 text. Lets the audio path be exercised end to end in tests. */
export class MockSpeechToText implements SpeechToText {
  readonly name = 'mock-stt';
  async transcribe(c: AudioChunk) { return c.audio instanceof Blob ? await c.audio.text() : new TextDecoder().decode(c.audio); }
}
/** Whisper over HTTP: point at a small self-hosted server (faster-whisper / whisper.cpp server) that
 *  accepts multipart `file` and returns {text}. The OpenAI-compatible /v1/audio/transcriptions shape works too. */
export class HttpWhisper implements SpeechToText {
  readonly name = 'whisper-http';
  constructor(private url: string, private apiKey?: string, private model = 'whisper-1') {}
  async transcribe(c: AudioChunk) {
    const fd = new FormData(); fd.append('file', c.audio instanceof Blob ? c.audio : new Blob([c.audio], { type: c.mime }), 'call.wav'); fd.append('model', this.model);
    const r = await fetch(this.url, { method: 'POST', body: fd, headers: this.apiKey ? { Authorization: `Bearer ${this.apiKey}` } : {} });
    if (!r.ok) throw new Error(`STT ${r.status}`); return ((await r.json()).text ?? '') as string;
  }
}
/** Wraps an audio source + STT into a transcript source. */
export class AudioTranscriptSource implements IncidentSource {
  constructor(readonly name: string, private audio: { start(on: (c: AudioChunk) => void): () => void }, private stt: SpeechToText) {}
  start(emit: (e: SourceEvent) => void) {
    return this.audio.start(async c => { try { const text = await this.stt.transcribe(c); emit({ kind: 'transcript', t: { text, timestamp: c.timestamp, feed: c.feed } }); } catch { /* drop */ } });
  }
}
/** Replays fixture transcripts with back-dated timestamps so the >=10 min delay gate can be demoed immediately. */
export class MockTranscriptSource implements IncidentSource {
  readonly name = 'mock (synthetic Champaign transcripts)';
  constructor(private lines: string[], private intervalMs = 1500, private backdateMs = 40 * 60_000, private now = () => Date.now()) {}
  start(emit: (e: SourceEvent) => void) {
    let i = 0; const base = this.now() - this.backdateMs; const step = this.backdateMs / Math.max(1, this.lines.length);
    const tick = () => { if (i >= this.lines.length) return; emit({ kind: 'transcript', t: { text: this.lines[i], timestamp: base + i * step, feed: 'mock' } }); i++; };
    const h = setInterval(tick, this.intervalMs); tick();
    return () => clearInterval(h);
  }
}
/** REAL text source: City of Champaign public ArcGIS layer of fire/EMS incidents (Jul 2023 – Jul 2024).
 *  Historic, not live; CORS allows github.io. Replayed as if recent so the map has real addresses/types.
 *  We read only dispatch_type, incident_location, incident_date_time. Unit field (f1st_arriving) is never requested. */
export const CHAMPAIGN_FIRE_LAYER = 'https://gisportal.champaignil.gov/hs/rest/services/Hosted/combined_incidents_July2023to2024/FeatureServer/0/query';
export class ChampaignArcgisReplaySource implements IncidentSource {
  readonly name = 'City of Champaign fire/EMS incidents (2023-24, replay)';
  constructor(private count = 25, private intervalMs = 800, private now = () => Date.now(), private fetchFn: typeof fetch = (...a) => fetch(...a)) {}
  start(emit: (e: SourceEvent) => void) {
    let stopped = false; let h: ReturnType<typeof setInterval> | undefined;
    const q = new URLSearchParams({ where: '1=1', outFields: 'dispatch_type,incident_location,incident_date_time', orderByFields: 'incident_date_time desc', resultRecordCount: String(this.count), outSR: '4326', f: 'json' });
    this.fetchFn(`${CHAMPAIGN_FIRE_LAYER}?${q}`).then(r => r.json()).then((j: any) => {
      if (stopped) return;
      const feats = (j.features ?? []) as { attributes: any; geometry?: { x: number; y: number } }[];
      const newest = Math.max(...feats.map(f => f.attributes.incident_date_time)); const shift = this.now() - 15 * 60_000 - newest;
      let i = 0;
      h = setInterval(() => {
        const f = feats[i++]; if (!f) return clearInterval(h);
        const a = f.attributes;
        emit({ kind: 'structured', c: { callType: String(a.dispatch_type || 'unknown').toLowerCase(), location: String(a.incident_location || ''), timestamp: Math.min(this.now() - 12 * 60_000, a.incident_date_time + shift), status: 'dispatched', feed: 'champaign-arcgis', lat: f.geometry?.y, lng: f.geometry?.x } });
      }, this.intervalMs);
    }).catch(() => {});
    return () => { stopped = true; if (h) clearInterval(h); };
  }
}
