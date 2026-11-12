import {describe,expect,it} from 'vitest';
import {thumbnailEvictionCandidate} from '../src/v2/thumbnailRail';

describe('thumbnail bitmap retention',()=>{
  const retained=new Set([1,2,3,4]);
  it('recycles the oldest off-screen bitmap while keeping visible page previews intact',()=>{
    expect(thumbnailEvictionCandidate(retained,new Set([1,2,4]))).toBe(3);
    expect(thumbnailEvictionCandidate(retained,new Set([2,4]))).toBe(1);
  });
  it('never evicts a visible thumbnail when every cached page is on screen',()=>{
    expect(thumbnailEvictionCandidate(retained,new Set([1,2,3,4,5]))).toBeUndefined();
    expect(thumbnailEvictionCandidate(new Set<number>(),new Set([1]))).toBeUndefined();
  });
  it('never mutates the retained order or the visible set',()=>{
    const visible=new Set([2,3]);
    expect(thumbnailEvictionCandidate(retained,visible)).toBe(1);
    expect([...retained]).toEqual([1,2,3,4]);
    expect([...visible]).toEqual([2,3]);
  });
});
