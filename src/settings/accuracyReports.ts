/** Updates (bell) > Accuracy reports tab. Text supplied by the project owner (Community Accuracy Update, Nov 2, 2026); wording kept intact. */
export type Block = { p: string } | { ul: string[] } | { table: { head: string[]; rows: string[][][] } };
export interface AccuracySection { title: string; blocks: Block[] }
export interface AccuracyReport { title: string; subtitle: string; date: string; sections: AccuracySection[]; footer: string }

export const ACCURACY_REPORTS: AccuracyReport[] = [{
  title: 'Patrol Radar', subtitle: 'Community Accuracy Update', date: 'November 2, 2026 | Champaign-Urbana Focus',
  sections: [
    { title: 'Field Scan Accuracy Summary', blocks: [{ p: 'This report summarizes detection performance from recent field drives and recorded scans in the Champaign-Urbana area. Data is drawn from Android app sessions using Bluetooth and Wi-Fi signature matching (Axon, Cradlepoint, and related police device identifiers). Results reflect current app versions (1.0.18) prior to the latest map and signature improvements.' }] },
    { title: 'Recorded Sessions', blocks: [{ table: { head: ['Date / Session', 'Conditions', 'Key Results'], rows: [
      [['Oct 26', 'Near CPD', '(Traffic Stop)'], ['Police present', 'Android field test'], ['~2,490 unmatched adverts', '5 distinct Axon devices matched', '(RSSI -91 to -97)']],
      [['Oct 28', '(2 tests)'], ['Urban / mixed areas', 'Near hospital police cars'], ['No pings on either pass', 'Flock camera battery units observed']],
      [['Nov 1', 'Debug files'], ['Police-only filter on', 'Highway / All devices'], ['0 adverts (filter active)', '921 adverts from 37 devices', '(All devices mode)']],
      [['Nov 2', '12:22–12:27 PM'], ['Normal scan', 'All devices', 'App 1.0.18'], ['Healthy scanner', '2,602 adverts / 569 devices', '0 signature matches', '315 GPS fixes (~2 m accuracy)']],
      [['Nov 2', '12:44–1:10 PM'], ['Hospital police drive', 'Switched to police-only', 'App 1.0.18'], ['Scanner idle after start', '9 adverts / 2 devices', '1 Cradlepoint-OUI hit (hint, 0.3)', '1,604 GPS fixes (~2 m)']],
    ] } }] },
    { title: 'Accuracy Observations', blocks: [{ ul: [
      'Axon signature detections worked in the Oct 26 traffic-stop scenario (5 devices identified). Later sessions with police presence produced no Axon hits, consistent with known limitations around plain-clothes / off-duty vehicles and body-cam presence.',
      'Cradlepoint / Wi-Fi signatures produced one unverified hint (0.3 confidence) during the Nov 2 hospital drive. Standalone Cradlepoint routers are common; higher confidence requires corroborating signals.',
      'Scanner health was generally good in All-devices mode (high advert volume, short gaps). Police-only mode can suppress traffic and appear idle when no matching signatures are present.',
      'GPS accuracy averaged ~2 m across sessions. Map pin placement improvements (strongest-signal anchoring + uncertainty circles) are shipping in 1.0.19 to reduce positional error at speed.',
      'False negatives remain the primary challenge. Multiple passes near known police activity yielded zero signature matches. Range, orientation, device power state, and signature coverage all contribute.',
    ] }] },
    { title: 'What’s Next', blocks: [{ p: 'Version 1.0.19 (now in Google Play Alpha review) includes:' }, { ul: [
      'More visible Wi-Fi hit styling and multi-signal vehicle grouping',
      'Strongest-signal pin placement with uncertainty circles (reduces estimated error from ~50–150 m to ~20–50 m in simulations)',
      'Map bug fixes (fixed pin anchoring, smoother radius circles)',
      'Continued focus on Champaign-Urbana coverage while exploring radio-dispatch options for higher-fidelity local data.',
    ] }] },
  ],
  footer: 'This is an informal community update based on developer field scans. Detection is probabilistic and not a guarantee of police presence or absence. Drive safe.',
}];

const esc = (s: string) => s.replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]!));
const cell = (lines: string[]) => lines.map(esc).join('<br>');
function block(b: Block): string {
  if ('p' in b) return `<p>${esc(b.p)}</p>`;
  if ('ul' in b) return `<ul>${b.ul.map(x => `<li>${esc(x)}</li>`).join('')}</ul>`;
  return `<div class="acc-table"><table><thead><tr>${b.table.head.map(h => `<th>${esc(h)}</th>`).join('')}</tr></thead><tbody>${b.table.rows.map(r => `<tr>${r.map(c => `<td>${cell(c)}</td>`).join('')}</tr>`).join('')}</tbody></table></div>`;
}
export function accuracyHtml(reports = ACCURACY_REPORTS): string {
  return reports.map(r => `<article class="acc-report"><h3>${esc(r.title)}</h3><p class="acc-sub"><b>${esc(r.subtitle)}</b><br><small>${esc(r.date)}</small></p>${r.sections.map(s => `<h4>${esc(s.title)}</h4>${s.blocks.map(block).join('')}`).join('')}<p class="acc-footer"><small>${esc(r.footer)}</small></p></article>`).join('');
}
