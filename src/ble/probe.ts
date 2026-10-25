/** Lists API surface for field debugging (names only, no values). */
export function propNames(obj: any): string[] {
  const out = new Set<string>(); let o = obj, depth = 0;
  while (o && o !== Object.prototype && depth++ < 10) { for (const k of Object.getOwnPropertyNames(o)) out.add(k); o = Object.getPrototypeOf(o); }
  return [...out].sort();
}
const RE = /scan|advert/i;
export interface ApiFind { path: string; obj: any; name: string; }
/** Finds scan/advert methods on navigator.bluetooth, window.bluetooth, and Bluefy-ish globals. */
export function findScanApis(win: any = window): ApiFind[] {
  const roots: [string, any][] = [['navigator.bluetooth', win.navigator?.bluetooth], ['window.bluetooth', win.bluetooth]];
  for (const k of Object.getOwnPropertyNames(win)) if (/blue|ble/i.test(k) && !/^(blur|onblur)$/i.test(k) && k !== 'bluetooth') { try { roots.push([`window.${k}`, win[k]]); } catch { /* */ } }
  const res: ApiFind[] = []; const seen = new Set<any>();
  for (const [p, o] of roots) { if (!o || (typeof o !== 'object' && typeof o !== 'function') || seen.has(o)) continue; seen.add(o);
    for (const n of propNames(o)) { let v; try { v = o[n]; } catch { continue; } if (typeof v === 'function' && RE.test(n)) res.push({ path: `${p}.${n}`, obj: o, name: n }); } }
  return res;
}
export function probeReport(win: any = window): string {
  const nb = win.navigator?.bluetooth;
  const globals = Object.getOwnPropertyNames(win).filter(k => /blue|ble|bluefy/i.test(k) && !/^(blur|onblur)$/i.test(k));
  const dev = win.BluetoothDevice?.prototype;
  return [
    `UA: ${win.navigator?.userAgent}`,
    `navigator.bluetooth props: ${nb ? propNames(nb).join(', ') : '(none)'}`,
    `window.bluetooth: ${win.bluetooth ? propNames(win.bluetooth).join(', ') : '(none)'}`,
    `Bluefy-ish globals: ${globals.join(', ') || '(none)'}`,
    `BluetoothDevice.prototype: ${dev ? propNames(dev).join(', ') : '(none)'}`,
    `scan/advert functions: ${findScanApis(win).map(f => f.path).join(', ') || '(none)'}`,
  ].join('\n');
}
