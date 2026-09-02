export interface ProjectFileMetadata {
  name: string;
  size: number;
  type: string;
  lastModified: number;
}

export type ProjectOptionValue = string | boolean;

export interface ProjectSnapshot {
  id: 'last';
  toolId: string;
  updatedAt: string;
  files: ProjectFileMetadata[];
  options: Record<string, ProjectOptionValue>;
}

const DB_NAME = 'docflow-project-state';
const STORE_NAME = 'snapshots';
const DB_VERSION = 1;

function openDatabase(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    if (!('indexedDB' in window)) {
      reject(new Error('INDEXEDDB_UNAVAILABLE'));
      return;
    }
    const request = indexedDB.open(DB_NAME, DB_VERSION);
    request.onupgradeneeded = () => {
      const database = request.result;
      if (!database.objectStoreNames.contains(STORE_NAME)) database.createObjectStore(STORE_NAME, { keyPath: 'id' });
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error ?? new Error('INDEXEDDB_OPEN_FAILED'));
    request.onblocked = () => reject(new Error('INDEXEDDB_BLOCKED'));
  });
}

function transactionDone(transaction: IDBTransaction): Promise<void> {
  return new Promise((resolve, reject) => {
    transaction.oncomplete = () => resolve();
    transaction.onerror = () => reject(transaction.error ?? new Error('INDEXEDDB_TRANSACTION_FAILED'));
    transaction.onabort = () => reject(transaction.error ?? new Error('INDEXEDDB_TRANSACTION_ABORTED'));
  });
}

export async function saveProjectSnapshot(input: Omit<ProjectSnapshot, 'id' | 'updatedAt'>): Promise<ProjectSnapshot> {
  const snapshot: ProjectSnapshot = {
    id: 'last',
    toolId: input.toolId,
    updatedAt: new Date().toISOString(),
    files: input.files.map((file) => ({ ...file })),
    options: { ...input.options }
  };
  const database = await openDatabase();
  try {
    const transaction = database.transaction(STORE_NAME, 'readwrite');
    transaction.objectStore(STORE_NAME).put(snapshot);
    await transactionDone(transaction);
    return snapshot;
  } finally {
    database.close();
  }
}

export async function loadProjectSnapshot(): Promise<ProjectSnapshot | null> {
  const database = await openDatabase();
  try {
    const transaction = database.transaction(STORE_NAME, 'readonly');
    const done = transactionDone(transaction);
    const request = transaction.objectStore(STORE_NAME).get('last');
    const value = await new Promise<unknown>((resolve, reject) => {
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error ?? new Error('INDEXEDDB_READ_FAILED'));
    });
    await done;
    if (!value || typeof value !== 'object') return null;
    const snapshot = value as Partial<ProjectSnapshot>;
    if (snapshot.id !== 'last' || typeof snapshot.toolId !== 'string' || typeof snapshot.updatedAt !== 'string') return null;
    if (!Array.isArray(snapshot.files) || !snapshot.options || typeof snapshot.options !== 'object') return null;
    return snapshot as ProjectSnapshot;
  } finally {
    database.close();
  }
}

export async function clearProjectSnapshot(): Promise<void> {
  const database = await openDatabase();
  try {
    const transaction = database.transaction(STORE_NAME, 'readwrite');
    transaction.objectStore(STORE_NAME).delete('last');
    await transactionDone(transaction);
  } finally {
    database.close();
  }
}
