interface SnapshotStatus {
  snapshotId: string;
  status: string;
  regions: string[];
  expiresAt?: Date;
}

interface SnapshotConfiguration {
  verified: boolean;
  snapshotId: string | null;
}

type LookupSnapshot = (id: string, signal: AbortSignal) => Promise<SnapshotStatus>;

export async function workerHealthResponse(
  config: SnapshotConfiguration,
  expectedId: string,
  lookup: LookupSnapshot,
  now = Date.now,
): Promise<Response> {
  const response = (snapshotVerified: boolean, expiresAt: string | null) => Response.json({
    service: 'docflow-processing',
    stage: 'engine-verification',
    snapshotVerified,
    expiresAt,
    acceptingDocuments: false,
  }, {status: snapshotVerified ? 200 : 503, headers: {'cache-control': 'no-store'}});

  if (!config.verified || !config.snapshotId || config.snapshotId !== expectedId) return response(false, null);
  const controller = new AbortController();
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    const deadline = new Promise<never>((_, reject) => {
      timer = setTimeout(() => {
        controller.abort();
        reject(new Error('Worker metadata deadline exceeded'));
      }, 2500);
    });
    const snapshot = await Promise.race([lookup(config.snapshotId, controller.signal), deadline]);
    const expiry = snapshot.expiresAt?.getTime();
    const available = snapshot.snapshotId === config.snapshotId
      && snapshot.status === 'created'
      && snapshot.regions.includes('fra1')
      && (expiry === undefined || expiry > now());
    return response(available, snapshot.expiresAt?.toISOString() ?? null);
  } catch {
    return response(false, null);
  } finally {
    clearTimeout(timer);
  }
}
