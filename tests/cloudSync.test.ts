import { describe, it, expect } from 'vitest';
import { sanitizeCloudTools } from '../src/app/cloudSync';

const valid = new Set(['merge', 'split', 'rotate', 'preview']);

describe('cloud preference allow-list', () => {
  it('keeps only known tool IDs and removes duplicates', () => {
    expect(sanitizeCloudTools({
      favorite_tools: ['merge', 'merge', 'unknown', 'rotate', 123, '<img>'],
      recent_tools: ['preview', 'rotate', 'preview', 'unknown']
    }, valid)).toEqual({ favorite_tools: ['merge', 'rotate'], recent_tools: ['preview', 'rotate'] });
  });
  it('rejects malformed payloads without throwing', () => {
    expect(sanitizeCloudTools(null, valid)).toEqual({ favorite_tools: [], recent_tools: [] });
    expect(sanitizeCloudTools({ favorite_tools: 'merge', recent_tools: 15 }, valid)).toEqual({ favorite_tools: [], recent_tools: [] });
  });
});
