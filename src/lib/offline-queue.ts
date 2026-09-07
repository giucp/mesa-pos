import {
  canQueueOffline,
  deriveSyncState,
  isServerOnlyAction,
  offlineBlockMessage,
  planMutation,
} from "@/lib/sync-state";

export type QueueKind = "pedido" | "mesa" | "kds" | "cobro" | "print";

export type QueueJob = {
  id: string;
  kind: QueueKind;
  action: string;
  payload: Record<string, unknown>;
  createdAt: number;
  status: "pending" | "syncing" | "error";
  error?: string;
  attempts: number;
};

const DB_NAME = "mesa-offline";
const STORE = "jobs";
export const QUEUE_EVENT = "mesa-queue-changed";
export const CONFLICT_EVENT = "mesa-sync-conflict";

function notify() {
  if (typeof window === "undefined") return;
  window.dispatchEvent(new Event(QUEUE_EVENT));
}

function openDb(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, 1);
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains(STORE)) {
        db.createObjectStore(STORE, { keyPath: "id" });
      }
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

function newOpId() {
  if (typeof crypto !== "undefined" && crypto.randomUUID) return crypto.randomUUID();
  return `op-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}

export function stableJobId(spec: Pick<QueueJob, "action" | "payload"> & { id?: string }) {
  if (spec.id) return spec.id;
  const payload = spec.payload ?? {};
  if (typeof payload.clientOpId === "string" && payload.clientOpId) return payload.clientOpId;
  if (typeof payload.idempotencyKey === "string" && payload.idempotencyKey) return payload.idempotencyKey;
  return newOpId();
}

export async function enqueueJob(
  input: Pick<QueueJob, "kind" | "action" | "payload"> & { id?: string },
): Promise<QueueJob> {
  const id = stableJobId(input);
  const existing = (await listJobs()).find((j) => j.id === id);
  const job: QueueJob = {
    id,
    kind: input.kind,
    action: input.action,
    payload: input.payload,
    createdAt: existing?.createdAt ?? Date.now(),
    status: "pending",
    attempts: existing?.attempts ?? 0,
  };
  const db = await openDb();
  await new Promise<void>((resolve, reject) => {
    const tx = db.transaction(STORE, "readwrite");
    tx.objectStore(STORE).put(job);
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });
  db.close();
  notify();
  return job;
}

export async function listJobs(): Promise<QueueJob[]> {
  if (typeof indexedDB === "undefined") return [];
  const db = await openDb();
  const jobs = await new Promise<QueueJob[]>((resolve, reject) => {
    const tx = db.transaction(STORE, "readonly");
    const req = tx.objectStore(STORE).getAll();
    req.onsuccess = () => resolve((req.result as QueueJob[]) ?? []);
    req.onerror = () => reject(req.error);
  });
  db.close();
  return jobs.sort((a, b) => a.createdAt - b.createdAt);
}

export async function queueSnapshot() {
  const jobs = await listJobs();
  const pending = jobs.filter((j) => j.status === "pending" || j.status === "syncing").length;
  const errors = jobs.filter((j) => j.status === "error").length;
  return {
    jobs,
    pending,
    errors,
    unsynced: pending + errors,
    view: deriveSyncState({
      online: typeof navigator === "undefined" ? true : navigator.onLine,
      pending: pending + errors,
      errors,
    }),
  };
}

export async function pendingCount() {
  const snap = await queueSnapshot();
  return snap.unsynced;
}

export async function updateJob(id: string, patch: Partial<QueueJob>) {
  const db = await openDb();
  await new Promise<void>((resolve, reject) => {
    const tx = db.transaction(STORE, "readwrite");
    const store = tx.objectStore(STORE);
    const get = store.get(id);
    get.onsuccess = () => {
      const current = get.result as QueueJob | undefined;
      if (!current) return;
      store.put({ ...current, ...patch });
    };
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });
  db.close();
  notify();
}

export async function removeJob(id: string) {
  const db = await openDb();
  await new Promise<void>((resolve, reject) => {
    const tx = db.transaction(STORE, "readwrite");
    tx.objectStore(STORE).delete(id);
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });
  db.close();
  notify();
}

export function isLikelyOfflineError(error?: string | null) {
  if (!error) return false;
  return /fetch|network|Failed to fetch|Load failed|offline|ECONN|timeout/i.test(error);
}

export type RunOrQueueResult<T> = T & {
  queued?: boolean;
  unknown?: boolean;
  blocked?: boolean;
};

export async function runOrQueue<T extends { error?: string; ok?: boolean }>(
  spec: Pick<QueueJob, "kind" | "action" | "payload"> & { id?: string; requiresStockConfirm?: boolean },
  runner: () => Promise<T>,
): Promise<RunOrQueueResult<T>> {
  const offline = typeof navigator !== "undefined" && !navigator.onLine;
  const plan = planMutation({
    online: !offline,
    action: spec.action,
    requiresStockConfirm: spec.requiresStockConfirm,
  });
  if (plan.kind === "block") {
    return { error: plan.error, blocked: true } as RunOrQueueResult<T>;
  }
  if (plan.kind === "queue") {
    await enqueueJob(spec);
    return { queued: true } as RunOrQueueResult<T>;
  }

  try {
    const res = await runner();
    if (res?.error && isLikelyOfflineError(res.error)) {
      if (spec.requiresStockConfirm) {
        return {
          ...res,
          unknown: true,
          error:
            "No se confirmó el inventario. No se reservó stock. El servidor tiene que verificar existencias.",
        } as RunOrQueueResult<T>;
      }
      if (isServerOnlyAction(spec.action)) {
        return { ...res, unknown: true, error: res.error } as RunOrQueueResult<T>;
      }
      if (canQueueOffline(spec.action)) {
        await enqueueJob(spec);
        return {
          ...res,
          queued: true,
          unknown: spec.action === "addPayment",
        };
      }
      return { ...res, unknown: true };
    }
    return res;
  } catch (error) {
    const message = error instanceof Error ? error.message : "Sin conexión";
    if (spec.requiresStockConfirm) {
      return {
        error:
          "No se confirmó el inventario. No se reservó stock. El servidor tiene que verificar existencias.",
        unknown: true,
        blocked: true,
      } as RunOrQueueResult<T>;
    }
    if (isServerOnlyAction(spec.action)) {
      return { error: message, unknown: true } as RunOrQueueResult<T>;
    }
    if (canQueueOffline(spec.action)) {
      await enqueueJob(spec);
      return {
        error: message,
        queued: true,
        unknown: spec.action === "addPayment",
      } as RunOrQueueResult<T>;
    }
    return { error: offlineBlockMessage(spec.action), blocked: true } as RunOrQueueResult<T>;
  }
}
