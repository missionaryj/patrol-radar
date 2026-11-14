import { describe, expect, it, vi } from 'vitest';
import { wireNavigationMapControls } from './mapControls';

function button() {
  const attrs: Record<string,string> = {};
  return {
    onclick: null as null | (() => void),
    textContent: '',
    setAttribute: (name: string, value: string) => { attrs[name] = value; },
    attrs
  };
}

describe('navigation map controls', () => {
  it('recenters from the pre-route navigation panel', () => {
    const location = button(), threeD = button(), recenter = vi.fn(() => true);
    wireNavigationMapControls(location, threeD, { recenter, set3D: vi.fn(async () => {}) }, false);
    location.onclick?.();
    expect(recenter).toHaveBeenCalledOnce();
  });

  it('toggles 3D and reports the pressed state', () => {
    const location = button(), threeD = button(), set3D = vi.fn(async () => {}), changed = vi.fn();
    wireNavigationMapControls(location, threeD, { recenter: vi.fn(() => true), set3D }, false, changed);
    expect(threeD.textContent).toBe('3D');
    expect(threeD.attrs['aria-pressed']).toBe('false');
    threeD.onclick?.();
    expect(set3D).toHaveBeenCalledWith(true);
    expect(changed).toHaveBeenCalledWith(true);
    expect(threeD.textContent).toBe('2D');
    expect(threeD.attrs['aria-pressed']).toBe('true');
    threeD.onclick?.();
    expect(set3D).toHaveBeenLastCalledWith(false);
  });
});
