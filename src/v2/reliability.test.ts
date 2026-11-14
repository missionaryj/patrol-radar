import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { GROUPED_RELIABILITY, reliabilityLine } from './reliability';

const GRADE = /\b(strong|likely|hint|grade|score)\b|%/i;

describe('detection reliability sentence', () => {
  it('uses everyday words for each kind of detection', () => {
    expect(reliabilityLine({ category: 'body-camera' })).toMatch(/body camera/);
    expect(reliabilityLine({ category: 'radio' })).toMatch(/outside police work/);
    expect(reliabilityLine({ category: 'fixed' })).toMatch(/not an officer nearby/);
    expect(reliabilityLine({ radio: 'wifi', vendor: 'Cradlepoint', category: 'vehicle' })).toMatch(/often is not police/);
    expect(reliabilityLine({ radio: 'wifi', vendor: 'Axon', category: 'body-camera' })).toMatch(/can still be/);
    expect(reliabilityLine({ radio: 'wifi', category: 'fixed', vendor: 'Flock Safety' })).toMatch(/fixed camera/);
    expect(GROUPED_RELIABILITY).toMatch(/one patrol car/);
  });
  it('never uses grades or scores', () => {
    const lines = [
      reliabilityLine({}),
      reliabilityLine({ category: 'body-camera' }),
      reliabilityLine({ category: 'cew' }),
      reliabilityLine({ category: 'radio' }),
      reliabilityLine({ category: 'fixed' }),
      reliabilityLine({ category: 'vehicle' }),
      reliabilityLine({ radio: 'wifi', vendor: 'Axon' }),
      reliabilityLine({ radio: 'wifi', vendor: 'Sierra Wireless', category: 'vehicle' }),
      GROUPED_RELIABILITY,
    ];
    for (const line of lines) expect(line, line).not.toMatch(GRADE);
  });
  it('is the sentence on the live detection cards', () => {
    const main = readFileSync('src/v2/main.ts', 'utf8');
    expect(main).toContain('reliabilityLine(');
    expect(main).toContain('GROUPED_RELIABILITY');
  });
});
