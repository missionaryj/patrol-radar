import { SessionRecorder } from './recorder';
declare const __APP_VERSION__: string;
const ver = typeof __APP_VERSION__ === 'string' ? __APP_VERSION__ : 'dev';

/** Mounts Record/Stop · Export · Clear + live counts into `host`. */
export function mountRecorder(host: HTMLElement, rec: SessionRecorder, backend: () => string) {
  const box = document.createElement('div'); box.className = 'recorder'; box.id = 'recorder';
  box.innerHTML = `<button id="rec-toggle" class="rec-btn"></button><button id="rec-export">Export</button><button id="rec-clear">Clear</button>
    <span class="rec-stats"><b id="rec-count">0</b> adverts · <b id="rec-devs">0</b> devices</span>`;
  host.appendChild(box);
  const q = (id: string) => box.querySelector<HTMLElement>('#' + id)!;
  const render = () => {
    q('rec-toggle').textContent = rec.recording ? '■ Stop rec' : '● Record';
    q('rec-toggle').classList.toggle('on', rec.recording);
    q('rec-count').textContent = String(rec.count); q('rec-devs').textContent = String(rec.devices);
  };
  q('rec-toggle').onclick = () => { rec.recording ? rec.stop() : rec.start(backend()); render(); };
  q('rec-clear').onclick = () => { if (confirm('Clear recorded adverts?')) { rec.clear(); render(); } };
  q('rec-export').onclick = () => {
    const blob = new Blob([JSON.stringify(rec.exportObject(ver), null, 2)], { type: 'application/json' });
    const a = document.createElement('a'); a.href = URL.createObjectURL(blob);
    a.download = `patrol-radar-session-${new Date().toISOString().replace(/[:.]/g, '-')}.json`; a.click();
    setTimeout(() => URL.revokeObjectURL(a.href), 5000);
  };
  render(); setInterval(render, 1000);
  return render;
}
