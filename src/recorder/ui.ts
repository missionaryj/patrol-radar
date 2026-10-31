import { SessionRecorder } from './recorder';
import { exportSession, isNativeShare } from './share';
declare const __APP_VERSION__: string;
const ver = typeof __APP_VERSION__ === 'string' ? __APP_VERSION__ : 'dev';

/** Mounts Record/Stop · Export · Clear + live counts into `host`. */
export function mountRecorder(host: HTMLElement, rec: SessionRecorder, backend: () => string) {
  const box = document.createElement('div'); box.className = 'recorder'; box.id = 'recorder';
  box.innerHTML = `<button id="rec-toggle" class="rec-btn"></button><button id="rec-export">${isNativeShare() ? 'Share file' : 'Export'}</button><button id="rec-clear">Clear</button>
    <span class="rec-stats"><b id="rec-count">0</b> adverts · <b id="rec-devs">0</b> devices</span>
    <div class="rec-health" id="rec-health" style="font-size:12px;opacity:.85;width:100%"></div>`;
  host.appendChild(box);
  const q = (id: string) => box.querySelector<HTMLElement>('#' + id)!;
  const render = () => {
    q('rec-toggle').textContent = rec.recording ? '■ Stop rec' : '● Record';
    q('rec-toggle').classList.toggle('on', rec.recording);
    q('rec-count').textContent = String(rec.count); q('rec-devs').textContent = String(rec.devices);
    q('rec-health').textContent = rec.s.startedAt ? rec.healthLine() : '';
  };
  q('rec-toggle').onclick = () => {
    if (rec.recording) { rec.stop(); render(); alert(`Recording stopped.\n${rec.healthLine()}`); } else { rec.start(backend()); render(); }
  };
  q('rec-clear').onclick = () => { if (confirm('Clear recorded adverts?')) { rec.clear(); render(); } };
  q('rec-export').onclick = () => {
    exportSession(JSON.stringify(rec.exportObject(ver), null, 2)).catch(e => alert(`Could not share the session file: ${e?.message ?? e}`));
  };
  render(); setInterval(render, 1000);
  return render;
}
