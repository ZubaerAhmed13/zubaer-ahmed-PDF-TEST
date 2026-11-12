import { describe, expect, it } from 'vitest';
import { canDuplicateOrganizerPage } from '../src/v2/pageOrganizer';

describe('organizer duplicate button policy', () => {
  it('accepts safe duplicate actions and blocks the 1,001st output page', () => {
    expect(canDuplicateOrganizerPage(1)).toBe(true);
    expect(canDuplicateOrganizerPage(999)).toBe(true);
    expect(canDuplicateOrganizerPage(1000)).toBe(false);
    expect(canDuplicateOrganizerPage(1001)).toBe(false);
  });
  it('rejects corrupt or empty draft counts', () => {
    for (const count of [-1, 0, NaN, Infinity, 1.5]) {
      expect(canDuplicateOrganizerPage(count)).toBe(false);
    }
  });
});
