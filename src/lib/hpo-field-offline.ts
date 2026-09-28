export type HpoOfflineMutationAction =
  | "hpo.route_stop.arrive"
  | "hpo.route_stop.set_outcome"
  | "hpo.route_stop.log_visit"
  | "hpo.route_stop.set_followup";

export type HpoOfflineMutation = {
  mutationId: string;
  traceId: string;
  action: HpoOfflineMutationAction;
  idempotencyKey: string;
  targetId: string;
  payload: Record<string, unknown>;
  createdAt: string;
  baseUpdatedAt?: string | null;
  attempts: number;
  status: "pending" | "syncing" | "failed";
  lastError?: string | null;
};

const DB_NAME = "emery_hpo_field_os";
const DB_VERSION = 1;
const STORE_ROUTES = "hpo_route_snapshots";
const STORE_OFFICES = "hpo_office_snapshots";
const STORE_DRAFTS = "hpo_draft_notes";
const STORE_OUTBOX = "hpo_outbox";
const STORE_SYNC = "hpo_sync_state";

function browserDb() {
  return typeof window !== "undefined" && typeof indexedDB !== "undefined";
}

function openDatabase(): Promise<IDBDatabase> {
  if (!browserDb()) return Promise.reject(new Error("IndexedDB is unavailable"));
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, DB_VERSION);
    request.onerror = () => reject(request.error ?? new Error("Could not open HPO offline storage"));
    request.onupgradeneeded = () => {
      const db = request.result;
      if (!db.objectStoreNames.contains(STORE_ROUTES)) db.createObjectStore(STORE_ROUTES, { keyPath: "key" });
      if (!db.objectStoreNames.contains(STORE_OFFICES)) db.createObjectStore(STORE_OFFICES, { keyPath: "key" });
      if (!db.objectStoreNames.contains(STORE_DRAFTS)) db.createObjectStore(STORE_DRAFTS, { keyPath: "key" });
      if (!db.objectStoreNames.contains(STORE_OUTBOX)) db.createObjectStore(STORE_OUTBOX, { keyPath: "mutationId" });
      if (!db.objectStoreNames.contains(STORE_SYNC)) db.createObjectStore(STORE_SYNC, { keyPath: "key" });
    };
    request.onsuccess = () => resolve(request.result);
  });
}

async function put(storeName: string, value: unknown) {
  if (!browserDb()) return;
  const db = await openDatabase();
  await new Promise<void>((resolve, reject) => {
    const transaction = db.transaction(storeName, "readwrite");
    transaction.objectStore(storeName).put(value);
    transaction.oncomplete = () => resolve();
    transaction.onerror = () => reject(transaction.error ?? new Error("Offline write failed"));
  });
  db.close();
}

async function get<T>(storeName: string, key: string): Promise<T | null> {
  if (!browserDb()) return null;
  const db = await openDatabase();
  const result = await new Promise<T | null>((resolve, reject) => {
    const transaction = db.transaction(storeName, "readonly");
    const request = transaction.objectStore(storeName).get(key);
    request.onsuccess = () => resolve((request.result as T | undefined) ?? null);
    request.onerror = () => reject(request.error ?? new Error("Offline read failed"));
  });
  db.close();
  return result;
}

async function remove(storeName: string, key: string) {
  if (!browserDb()) return;
  const db = await openDatabase();
  await new Promise<void>((resolve, reject) => {
    const transaction = db.transaction(storeName, "readwrite");
    transaction.objectStore(storeName).delete(key);
    transaction.oncomplete = () => resolve();
    transaction.onerror = () => reject(transaction.error ?? new Error("Offline delete failed"));
  });
  db.close();
}

async function all<T>(storeName: string): Promise<T[]> {
  if (!browserDb()) return [];
  const db = await openDatabase();
  const result = await new Promise<T[]>((resolve, reject) => {
    const transaction = db.transaction(storeName, "readonly");
    const request = transaction.objectStore(storeName).getAll();
    request.onsuccess = () => resolve((request.result as T[]) ?? []);
    request.onerror = () => reject(request.error ?? new Error("Offline read failed"));
  });
  db.close();
  return result;
}

export async function saveHpoRouteSnapshot(snapshot: any) {
  const routeId = snapshot?.route?.id;
  if (!routeId) return;
  const stored = {
    key: `route:${routeId}`,
    routeId,
    savedAt: new Date().toISOString(),
    snapshot,
  };
  await put(STORE_ROUTES, stored);
  await put(STORE_ROUTES, { ...stored, key: "active" });
}

export async function loadActiveHpoRouteSnapshot<T = any>() {
  const row = await get<{ snapshot: T }>(STORE_ROUTES, "active");
  return row?.snapshot ?? null;
}

export async function saveHpoOfficeSnapshots(offices: any[]) {
  const savedAt = new Date().toISOString();
  await put(STORE_OFFICES, { key: "active", savedAt, offices });
}

export async function loadHpoOfficeSnapshots<T = any[]>() {
  const row = await get<{ offices: T }>(STORE_OFFICES, "active");
  return row?.offices ?? null;
}

export async function saveHpoDraftNote(stopId: string, text: string) {
  await put(STORE_DRAFTS, {
    key: `stop:${stopId}`,
    stopId,
    text,
    updatedAt: new Date().toISOString(),
  });
}

export async function loadHpoDraftNote(stopId: string) {
  const row = await get<{ text: string }>(STORE_DRAFTS, `stop:${stopId}`);
  return row?.text ?? "";
}

export async function clearHpoDraftNote(stopId: string) {
  await remove(STORE_DRAFTS, `stop:${stopId}`);
}

export async function enqueueHpoMutation(
  input: Omit<HpoOfflineMutation, "mutationId" | "traceId" | "createdAt" | "attempts" | "status"> & {
    mutationId?: string;
    traceId?: string;
  },
) {
  const mutationId = input.mutationId || crypto.randomUUID();
  const mutation: HpoOfflineMutation = {
    ...input,
    mutationId,
    traceId: input.traceId || mutationId,
    createdAt: new Date().toISOString(),
    attempts: 0,
    status: "pending",
    lastError: null,
  };
  await put(STORE_OUTBOX, mutation);
  return mutation;
}

export async function listHpoOutbox() {
  const rows = await all<HpoOfflineMutation>(STORE_OUTBOX);
  return rows
    .filter((row) => row.status === "pending" || row.status === "failed")
    .sort((a, b) => Date.parse(a.createdAt) - Date.parse(b.createdAt));
}

export async function updateHpoOutboxMutation(
  mutation: HpoOfflineMutation,
  patch: Partial<HpoOfflineMutation>,
) {
  await put(STORE_OUTBOX, { ...mutation, ...patch });
}

export async function removeHpoOutboxMutation(mutationId: string) {
  await remove(STORE_OUTBOX, mutationId);
}

export async function pendingHpoMutationCount() {
  return (await listHpoOutbox()).length;
}

export async function saveHpoSyncState(value: Record<string, unknown>) {
  await put(STORE_SYNC, { key: "active", updatedAt: new Date().toISOString(), ...value });
}

export async function loadHpoSyncState<T = Record<string, unknown>>() {
  return get<T>(STORE_SYNC, "active");
}
