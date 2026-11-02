import { describe, it, expect } from 'vitest';
import { map3dDefault } from './mapSettings';
describe('3D default', () => {
  it('is on with no saved preference, off only when saved off', () => {
    expect(map3dDefault(null)).toBe(true); expect(map3dDefault('1')).toBe(true); expect(map3dDefault('0')).toBe(false);
  });
});
