import { nativePlugin } from '../ble/nativeScanner';

/** True inside the Capacitor Android app (native plugin present or Capacitor reports a native platform). */
export function nativeAppPresent(g: any = globalThis): boolean {
  if (g === globalThis && nativePlugin()) return true;
  return !!g.Capacitor?.isNativePlatform?.();
}

/** App: hide the scanner-backend picker (always native). Web: hide the Android-only scan mode, which has no effect there. */
export function applyPlatformSettings(doc: Pick<Document, 'getElementById'>, native: boolean) {
  const backendWrap = doc.getElementById('backend-wrap'), backend = doc.getElementById('backend') as HTMLSelectElement | null;
  const scanmode = doc.getElementById('scanmode-wrap');
  if (backendWrap) backendWrap.hidden = native;
  if (backend && native) { backend.value = 'native'; backend.disabled = true; }
  if (scanmode) scanmode.hidden = !native;
}
