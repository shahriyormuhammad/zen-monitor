import { describe, expect, it } from 'vitest';

import { canApplyDaypartingMutations } from './advertising-dayparting-scheduler';

describe('canApplyDaypartingMutations', () => {
  it('keeps advisor mode read-only', () => {
    expect(canApplyDaypartingMutations('advisor')).toBe(false);
    expect(canApplyDaypartingMutations(null)).toBe(false);
    expect(canApplyDaypartingMutations('unexpected')).toBe(false);
  });

  it('allows configured safe schedule mutations in semi-auto and auto modes', () => {
    expect(canApplyDaypartingMutations('semi_auto')).toBe(true);
    expect(canApplyDaypartingMutations('auto')).toBe(true);
  });
});
