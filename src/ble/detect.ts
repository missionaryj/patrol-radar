export type BackendKind = 'mock' | 'web' | 'bluefy';
/** Bluefy is the only iOS browser exposing navigator.bluetooth; UA may also contain "Bluefy". */
export function isBluefy(nav: any = navigator): boolean {
  const ua = String(nav.userAgent ?? '');
  return /bluefy/i.test(ua) || (/iPhone|iPad|iPod/.test(ua) && !!nav.bluetooth);
}
export function pickDefaultBackend(nav: any = navigator): BackendKind {
  if (isBluefy(nav)) return 'bluefy';
  return 'mock';
}
