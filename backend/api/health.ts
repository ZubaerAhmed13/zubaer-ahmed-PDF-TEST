import snapshot from '../engine-snapshot.json' with {type:'json'};

export function GET() {
  return Response.json({service:'docflow-processing',stage:'engine-verification',snapshotVerified:snapshot.verified,acceptingDocuments:false},{headers:{'Cache-Control':'no-store'}});
}
