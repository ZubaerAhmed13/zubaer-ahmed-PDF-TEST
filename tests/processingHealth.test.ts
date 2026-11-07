import {expect,it,vi} from 'vitest';
import {workerHealthResponse} from '../backend/health';

const id='snap_test_engine';
const config={verified:true,snapshotId:id};
const now=()=>Date.parse('2026-11-05T12:00:00.000Z');
const healthy={snapshotId:id,status:'created',regions:['fra1']};

it('reports a missing or mismatched engine configuration as unavailable before querying the provider',async()=>{
  const lookup=vi.fn();
  for(const config of [{verified:false,snapshotId:null},{verified:true,snapshotId:'snap_other'}]){
    const response=await workerHealthResponse(config,id,lookup,now);
    expect(response.status).toBe(503);
    expect(response.headers.get('cache-control')).toBe('no-store');
    expect(await response.json()).toMatchObject({
      service:'docflow-processing',
      snapshotVerified:false,
      acceptingDocuments:false,
    });
  }
  expect(lookup).not.toHaveBeenCalled();
});

it('uses live snapshot status and reports actual expiry without revealing the image ID',async()=>{
  const expiresAt=new Date(now()+60_000);
  const lookup=vi.fn().mockResolvedValue({...healthy,expiresAt});
  const response=await workerHealthResponse(config,id,lookup,now);
  expect(response.status).toBe(200);
  expect(lookup).toHaveBeenCalledWith(id,expect.any(AbortSignal));
  expect(await response.json()).toEqual({
    service:'docflow-processing',stage:'engine-verification',
    snapshotVerified:true,expiresAt:expiresAt.toISOString(),acceptingDocuments:false,
  });
  const durable=await workerHealthResponse(config,id,async()=>healthy,now);
  expect(durable.status).toBe(200);
  expect(await durable.json()).toMatchObject({expiresAt:null});
});

it('rejects expired, deleted, region-mismatched or unreachable snapshots',async()=>{
  for(const snapshot of [
    {...healthy,expiresAt:new Date(now())},
    {...healthy,status:'deleted'},
    {...healthy,regions:['iad1']},
  ]){
    expect((await workerHealthResponse(config,id,async()=>snapshot,now)).status).toBe(503);
  }
  const failed=await workerHealthResponse(config,id,async()=>{throw Error('provider internals');},now);
  expect(failed.status).toBe(503);
  expect(await failed.text()).not.toContain('provider internals');
});

it('returns unavailable within the deadline even when metadata lookup does not settle',async()=>{
  vi.useFakeTimers();
  try{
    const response=workerHealthResponse(config,id,()=>new Promise(()=>{}),now);
    const status=expect(response).resolves.toHaveProperty('status',503);
    await vi.advanceTimersByTimeAsync(2500);
    await status;
  }finally{vi.useRealTimers();}
});
