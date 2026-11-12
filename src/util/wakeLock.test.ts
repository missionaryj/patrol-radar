import { expect, it, vi } from 'vitest';
import { ScreenWake } from './wakeLock';

it('releases a wake lock that arrives after scan Stop', async () => {
  let resolve!: (lock: any) => void;
  const request = vi.fn(() => new Promise(r => { resolve = r; }));
  const wake = new ScreenWake({ wakeLock: { request } });
  const acquiring = wake.acquire();
  await wake.release();
  const lock = { release: vi.fn(async () => {}), released: false };
  resolve(lock);
  expect(await acquiring).toBe(false);
  expect(lock.release).toHaveBeenCalledOnce();
  expect(wake.held).toBe(false);
});
