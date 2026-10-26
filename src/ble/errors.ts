export type ScanErrorKind = 'unsupported' | 'permission' | 'adv-disabled' | 'insecure' | 'other';
export class ScanError extends Error { constructor(public kind: ScanErrorKind, msg: string) { super(msg); } }
export function classify(e: any): ScanError {
  if (e instanceof ScanError) return e;
  const n = e?.name ?? '', m = String(e?.message ?? e);
  if (n === 'NotAllowedError' || n === 'SecurityError' && /permission|denied|user/i.test(m) || /denied|not allowed|cancel/i.test(m))
    return new ScanError('permission', 'Bluetooth permission denied or chooser cancelled. Allow Bluetooth for this site/app and try again.');
  if (n === 'NotFoundError') return new ScanError('permission', /android/i.test(navigator.userAgent)
    ? `Scan was refused (${m}). Check: Android Settings › Apps › Chrome › Permissions › allow "Nearby devices" and Location; phone Location is ON; this site's Bluetooth scanning permission isn't blocked (lock icon › Permissions); then tap Allow on the scan prompt.`
    : `No device chosen (chooser cancelled). [${m}]`);
  if (n === 'NotSupportedError' || /not supported|undefined is not a function/i.test(m)) return new ScanError('unsupported', m);
  return new ScanError('other', m);
}
