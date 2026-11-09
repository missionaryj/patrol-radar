import { afterEach, describe, expect, it, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import { InitialMapView } from './startup';
afterEach(() => vi.useRealTimers());
describe('initial map viewport', () => {
  it('does not load an arbitrary city before GPS and never overwrites a fix with the timeout', () => {
    vi.useFakeTimers(); const show = vi.fn(); const startup = new InitialMapView(show);
    vi.advanceTimersByTime(500); expect(show).not.toHaveBeenCalled();
    startup.locate(33, -84); expect(show).toHaveBeenCalledWith(33, -84, 16);
    vi.advanceTimersByTime(10000); expect(show).toHaveBeenCalledOnce();
  });
  it('releases the map after four seconds without a GPS callback', () => {
    vi.useFakeTimers(); const show = vi.fn(); new InitialMapView(show);
    vi.advanceTimersByTime(4000); expect(show).toHaveBeenCalledWith(39, -98, 4);
  });
  it('releases immediately on denial and does not reset a later user viewport', () => {
    vi.useFakeTimers(); const show = vi.fn(); const startup = new InitialMapView(show);
    startup.fallback(); startup.locate(33, -84); vi.advanceTimersByTime(10000);
    expect(show).toHaveBeenCalledOnce(); expect(show).toHaveBeenCalledWith(39, -98, 4);
  });
  it('boots Android directly into an existing current UI entry, with a valid absolute local path', () => {
    const config = JSON.parse(readFileSync('capacitor.config.json', 'utf8'));
    expect(new URL('https://localhost' + config.server.appStartPath).pathname).toBe('/v2/index.html');
    const html = readFileSync('.' + config.server.appStartPath, 'utf8');
    expect(html).toContain('/src/v2/main.ts'); expect(html).not.toContain('/src/main.ts');
    expect(config.server.url).toBeUndefined();
  });
});
