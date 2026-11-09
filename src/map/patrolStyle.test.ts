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
  });
});
