import { describe, expect, it } from 'vitest';
import { PALETTE, style3d } from './palette';

describe('Patrol Mode road context', () => {
  it('renders more than a blank surface: local roads, major roads, names and towns', () => {
    const style=style3d('dark');
    const ids=style.layers.map((layer:{id:string})=>layer.id);
    expect(ids).toContain('roads');
    expect(ids).toContain('roads-major');
    expect(ids).toContain('road-labels');
    expect(ids).toContain('place-labels');
    expect(style.layers.find((layer:{id:string})=>layer.id==='place-labels')['source-layer']).toBe('place');
    expect(style.layers.find((layer:{id:string})=>layer.id==='road-labels')['source-layer']).toBe('transportation_name');
  });
  it('uses distinct high-contrast dark roads while preserving colored detection markers', () => {
    expect(PALETTE.dark.road).not.toBe(PALETTE.dark.land);
    expect(PALETTE.dark.roadMajor).not.toBe(PALETTE.dark.road);
    expect(PALETTE.dark.label).not.toBe(PALETTE.dark.land);
    const lum = (hex: string) => { const n = parseInt(hex.slice(1), 16); return ((n >> 16) & 255) * 0.2126 + ((n >> 8) & 255) * 0.7152 + (n & 255) * 0.0722; };
    expect(lum(PALETTE.light.land)).toBeGreaterThan(180);
    expect(lum(PALETTE.dark.land)).toBeLessThan(80);
    expect(style3d('light').layers[0].paint['background-color']).toBe(PALETTE.light.land);
  });
});
