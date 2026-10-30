import { describe, it, expect } from 'vitest';
import { nativeAppPresent, applyPlatformSettings } from './platform';

function fakeDoc() {
  const els: Record<string, any> = { 'backend-wrap': { hidden: false }, backend: { value: 'web', disabled: false }, 'scanmode-wrap': { hidden: false } };
  return { els, doc: { getElementById: (id: string) => els[id] ?? null } as any };
}
describe('platform settings', () => {
  it('detects Capacitor native', () => {
    expect(nativeAppPresent({ Capacitor: { isNativePlatform: () => true } })).toBe(true);
    expect(nativeAppPresent({})).toBe(false);
  });
  it('app: hides backend picker, forces native, shows scan mode', () => {
    const { els, doc } = fakeDoc(); applyPlatformSettings(doc, true);
    expect(els['backend-wrap'].hidden).toBe(true); expect(els.backend.value).toBe('native'); expect(els['scanmode-wrap'].hidden).toBe(false);
  });
  it('web: keeps backend picker, hides scan mode', () => {
    const { els, doc } = fakeDoc(); applyPlatformSettings(doc, false);
    expect(els['backend-wrap'].hidden).toBe(false); expect(els.backend.value).toBe('web'); expect(els['scanmode-wrap'].hidden).toBe(true);
  });
});
