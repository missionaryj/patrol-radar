export type BackendKind = 'mock' | 'web' | 'bluefy' | 'native';
/** Bluefy is the only iOS browser exposing navigator.bluetooth; UA may also contain "Bluefy". */
export function isBluefy(nav: any = navigator): boolean {
  const ua = String(nav.userAgent ?? '');
  return /bluefy/i.test(ua) || (/iPhone|iPad|iPod/.test(ua) && !!nav.bluetooth);
}
/** True inside the Capacitor Android app. */
export function isNativeApp(g: any = globalThis): boolean { return !!g.Capacitor?.isNativePlatform?.() && g.Capacitor?.getPlatform?.() === 'android'; }
export function pickDefaultBackend(nav: any = navigator, g: any = globalThis): BackendKind {
  if (isNativeApp(g)) return 'native';
  if (isBluefy(nav)) return 'bluefy';
  if (typeof nav.bluetooth?.requestLEScan === 'function') return 'web';
  return 'mock';
}
