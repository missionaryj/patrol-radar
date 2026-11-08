import { describe, expect, it } from 'vitest';
import { setupScannerPhrase, syncSetupScanner, webSetupMessage } from './setupCard';

function el(partial: Partial<{ hidden: boolean; textContent: string | null; childElementCount: number }> = {}) {
  return { hidden: false, textContent: '', childElementCount: 0, ...partial };
}

describe('setup card scanner line', () => {
  it('uses a status row in the app and a sentence on the web', () => {
    expect(setupScannerPhrase(true, true)).toBe('Active');
    expect(setupScannerPhrase(false, true)).toBe('Stopped — tap Scan on the map');
    expect(webSetupMessage(false)).toBe('Scanner: stopped. Phone permissions and battery settings cannot be checked here. Check them in your browser or device settings.');
    expect(webSetupMessage(true)).toContain('Scanner: active.');
  });

  it('updates a visible web sentence when scanning starts and stops', () => {
    const box = el({ textContent: webSetupMessage(false) });
    const doc = { getElementById: (id: string) => (id === 'setup-results' ? box : null) };
    syncSetupScanner(doc, true);
    expect(box.textContent).toContain('Scanner: active.');
    syncSetupScanner(doc, false);
    expect(box.textContent).toContain('Scanner: stopped.');
  });

  it('updates only the native scanner row', () => {
    const line = el({ textContent: 'Stopped — tap Scan on the map' });
    const box = el({ childElementCount: 6, textContent: 'Setup check' });
    const doc = { getElementById: (id: string) => (id === 'setup-scanner-state' ? line : id === 'setup-results' ? box : null) };
    syncSetupScanner(doc, true);
    expect(line.textContent).toBe('Active');
    expect(box.textContent).toBe('Setup check');
  });

  it('leaves a hidden card and an in-flight check alone', () => {
    const hidden = el({ hidden: true, textContent: webSetupMessage(false) });
    syncSetupScanner({ getElementById: (id: string) => (id === 'setup-results' ? hidden : null) }, true);
    expect(hidden.textContent).toContain('Scanner: stopped.');
    const checking = el({ textContent: 'Checking your setup…' });
    syncSetupScanner({ getElementById: (id: string) => (id === 'setup-results' ? checking : null) }, true);
    expect(checking.textContent).toBe('Checking your setup…');
  });
});
