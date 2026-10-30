import { describe, it, expect } from 'vitest';
import { velocityFor, predict, step, distM, SmoothLocation, PREDICT_CAP_MS, SNAP_M } from './smoothFollow';
import { FollowController } from './follow';

const base = { lat: 40.11, lng: -88.24, acc: 5, t: 0 };
describe('smooth follow', () => {
  it('uses device speed+heading', () => {
    const v = velocityFor({ ...base, speed: 10, heading: 90 })!;
    expect(v.ve).toBeCloseTo(10); expect(Math.abs(v.vn)).toBeLessThan(1e-9);
  });
  it('no prediction when stopped', () => {
    expect(velocityFor({ ...base, speed: 0, heading: 0 })).toBeNull();
    expect(predict(base, null, 5000)).toEqual({ lat: base.lat, lng: base.lng });
  });
  it('derives velocity from last two fixes and ignores GPS jumps', () => {
    const b = { ...base, lat: base.lat + 10 / 111_320, t: 1000 };
    expect(velocityFor(b, base)!.vn).toBeCloseTo(10, 0);
    const jump = { ...base, lat: base.lat + 1, t: 1000 };
    expect(velocityFor(jump, base)).toBeNull();
  });
  it('caps prediction at 1.5 s', () => {
    const v = { vn: 20, ve: 0 };
    expect(distM(base, predict(base, v, 10_000))).toBeCloseTo(20 * PREDICT_CAP_MS / 1000, 0);
  });
  it('glides for small moves, snaps for large errors', () => {
    const t = { lat: base.lat + 10 / 111_320, lng: base.lng };
    const s = step(base, t, 16); expect(distM(base, s)).toBeGreaterThan(0); expect(distM(s, t)).toBeGreaterThan(0);
    const far = { lat: base.lat + (SNAP_M * 2) / 111_320, lng: base.lng };
    expect(step(base, far, 16)).toEqual(far);
  });
  it('animation loop stops once settled and stationary', () => {
    const sl = new SmoothLocation(); sl.push(base); sl.push({ ...base, lat: base.lat + 3 / 111_320, t: 1000, speed: 0 });
    let more = true, now = 1000; for (let i = 0; i < 200 && more; i++) { now += 16; more = sl.tick(now, 16); }
    expect(more).toBe(false);
  });
  it('pan pauses follow, recenter resumes', () => {
    const f = new FollowController(true); f.userPanned(); expect(f.onFix()).toBe(false); f.resume(); expect(f.onFix()).toBe(true);
  });
});
