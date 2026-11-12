import { expect, it, vi } from 'vitest';
import { ScanSupervisor } from './supervisor';

it('does not restart a stopped web scanner after an in-flight async restart', async () => {
  let resume!: () => void;
  const waiting = new Promise<void>(r => { resume = r; });
  const scanner = { name: 'web-bluetooth', isSupported: vi.fn(async () => true),
    start: vi.fn(() => waiting), stop: vi.fn() };
  const warn = vi.fn(), recorder = { event: vi.fn() };
  const supervisor = new ScanSupervisor({ warn, recorder: recorder as any });
  vi.spyOn(supervisor.wake, 'acquire').mockResolvedValue(false);
  vi.spyOn(supervisor.wake, 'release').mockResolvedValue(undefined);
  await supervisor.started('web', scanner, vi.fn());
  const restarted = supervisor.restart();
  supervisor.stopped();
  resume();
  expect(await restarted).toBe(false);
  expect(scanner.stop).toHaveBeenCalledTimes(2);
  expect(recorder.event).not.toHaveBeenCalledWith('auto-restart', expect.anything());
  expect(warn).not.toHaveBeenCalledWith('Scan restarted.');
});
