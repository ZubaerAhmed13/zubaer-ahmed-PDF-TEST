import {Snapshot} from '@vercel/sandbox';
import engine from '../engine-lock.json' with {type:'json'};
import snapshot from '../engine-snapshot.json' with {type:'json'};
import {workerHealthResponse} from '../health.ts';

export function GET() {
  return workerHealthResponse(snapshot, engine.snapshotId, (snapshotId, signal) => Snapshot.get({snapshotId, signal}));
}
