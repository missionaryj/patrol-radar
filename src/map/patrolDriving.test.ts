import { describe, expect, it } from 'vitest';
import { PatrolMotion, patrolZoom, headingStep, MAX_PATROL_ZOOM, PATROL_DRIVE_ZOOM } from './patrolDriving';

describe('Patrol Mode moving map', () => {
  it('switches to moving view only after a plausible accurate driving fix', () => {
    const motion = new PatrolMotion();
    expect(motion.update(7, 100, 1000)).toBe(false);
    expect(motion.update(3, 2, 2000)).toBe(false);
    expect(motion.update(10, 5, 3000)).toBe(true);
    expect(motion.update(0, 5, 11000)).toBe(true);
    expect(motion.update(null, 5, 16001)).toBe(false);
  });
  it('rejects bad GPS speed and allows reset', () => {
    const motion = new PatrolMotion();
    expect(motion.update(300, 2, 1000)).toBe(false);
    expect(motion.update(NaN, 2, 2000)).toBe(false);
    expect(motion.update(15, 2, 3000)).toBe(true);
    motion.reset();
    expect(motion.update(null, 2, 3010)).toBe(false);
  });
  it('caps unsafe close zoom without over-zooming a distant view', () => {
    expect(patrolZoom(22, true)).toBe(PATROL_DRIVE_ZOOM);
    expect(patrolZoom(12, true)).toBe(12);
    expect(patrolZoom(22, false)).toBe(MAX_PATROL_ZOOM);
  });
  it('keeps the map bearing stable when GPS heading jumps or disappears', () => {
    expect(headingStep(350, 10)).toBeCloseTo(354.4);
    expect(headingStep(10, 350)).toBeCloseTo(5.6);
    expect(headingStep(40, null)).toBe(40);
    expect(headingStep(40, -1)).toBe(40);
  });
});
