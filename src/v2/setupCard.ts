/** Scanner wording on the setup card. The native card uses a status row; the web card uses a sentence. */
export function setupScannerPhrase(scanning: boolean, native: boolean): string {
  if (native) return scanning ? 'Active' : 'Stopped — tap Scan on the map';
  return scanning ? 'active' : 'stopped';
}

export function webSetupMessage(scanning: boolean): string {
  return `Scanner: ${setupScannerPhrase(scanning, false)}. Phone permissions and battery settings cannot be checked here. Check them in your browser or device settings.`;
}

type SetupEl = { hidden?: boolean; textContent: string | null; childElementCount: number };

/**
 * Keeps the visible setup card's scanner line aligned with scan start/stop.
 * A hidden card is left alone. So is an in-flight "Checking…" message, which has
 * no scanner row yet and does not start with the finished web sentence.
 */
export function syncSetupScanner(doc: { getElementById(id: string): SetupEl | null }, scanning: boolean): void {
  const box = doc.getElementById('setup-results');
  if (!box || box.hidden) return;
  const line = doc.getElementById('setup-scanner-state');
  if (line) {
    line.textContent = setupScannerPhrase(scanning, true);
    return;
  }
  if (box.childElementCount === 0 && (box.textContent ?? '').startsWith('Scanner: ')) box.textContent = webSetupMessage(scanning);
}
