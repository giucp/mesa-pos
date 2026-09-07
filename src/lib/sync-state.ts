export type SyncTone = "offline" | "syncing" | "ready" | "error";

export type SyncView = {
  label: "Sin conexión" | "Sincronizando" | "Al día" | "Error de sincronización";
  tone: SyncTone;
  pending: number;
};

/** Internet on the device is not the same as the server having saved the change. */
export function deriveSyncState(input: {
  online: boolean;
  pending: number;
  errors: number;
}): SyncView {
  const pending = Math.max(0, Math.round(input.pending));
  if (!input.online) {
    return { label: "Sin conexión", tone: "offline", pending };
  }
  if (input.errors > 0) {
    return { label: "Error de sincronización", tone: "error", pending };
  }
  if (pending > 0) {
    return { label: "Sincronizando", tone: "syncing", pending };
  }
  return { label: "Al día", tone: "ready", pending: 0 };
}

export const SERVER_ONLY_ACTIONS = ["confirmPayment", "closeShift"] as const;
export type ServerOnlyAction = (typeof SERVER_ONLY_ACTIONS)[number];

export const QUEUEABLE_ACTIONS = [
  "addItem",
  "sendKitchen",
  "openTable",
  "bump",
  "recall",
  "addPayment",
  "print",
] as const;

export function isServerOnlyAction(action: string) {
  return (SERVER_ONLY_ACTIONS as readonly string[]).includes(action);
}

export function canQueueOffline(action: string) {
  return (QUEUEABLE_ACTIONS as readonly string[]).includes(action) && !isServerOnlyAction(action);
}

export function offlineBlockMessage(action: string) {
  if (action === "confirmPayment") {
    return "Sin conexión: no se confirma el pago. El servidor tiene que registrar el cambio.";
  }
  if (action === "closeShift") {
    return "Sin conexión: no se cierra el turno. El servidor tiene que guardar el cierre.";
  }
  return "Esta operación requiere conexión con el servidor.";
}

export type MutationPlan =
  | { kind: "execute" }
  | { kind: "queue" }
  | { kind: "block"; error: string }
  | { kind: "unknown"; label: "Por verificar"; queueRetry: boolean };

/**
 * Decide what the client may do. Having internet ≠ the server saved the change.
 * confirmPayment / closeShift never fake success.
 */
export function planMutation(input: {
  online: boolean;
  action: string;
  attemptStarted?: boolean;
  responseLost?: boolean;
  requiresStockConfirm?: boolean;
}): MutationPlan {
  const serverOnly = isServerOnlyAction(input.action) || Boolean(input.requiresStockConfirm);
  if (input.responseLost || (input.attemptStarted && !input.online && input.action === "addPayment")) {
    if (input.action === "addPayment" || serverOnly) {
      return { kind: "unknown", label: "Por verificar", queueRetry: input.action === "addPayment" };
    }
  }
  if (!input.online) {
    if (input.requiresStockConfirm) {
      return {
        kind: "block",
        error:
          "Sin existencias confirmadas. El servidor tiene que verificar el inventario; no se promete stock sin conexión.",
      };
    }
    if (serverOnly) return { kind: "block", error: offlineBlockMessage(input.action) };
    if (canQueueOffline(input.action)) return { kind: "queue" };
    return { kind: "block", error: offlineBlockMessage(input.action) };
  }
  return { kind: "execute" };
}

export type ServerCheckSnapshot = {
  folio: string;
  updatedAt: string;
  lineIds: string[];
  lines: { id: string; name: string; qty: number; notes: string | null }[];
};

export function hasOrderConflict(input: {
  knownLineIds?: string[] | null;
  baseUpdatedAt?: string | Date | null;
  server: { updatedAt: Date; lines: { id: string }[] };
}) {
  if (input.knownLineIds) {
    const known = new Set(input.knownLineIds);
    return input.server.lines.some((line) => !known.has(line.id));
  }
  if (!input.baseUpdatedAt) return false;
  const base =
    typeof input.baseUpdatedAt === "string" ? new Date(input.baseUpdatedAt) : input.baseUpdatedAt;
  if (Number.isNaN(base.getTime())) return false;
  return input.server.updatedAt.getTime() > base.getTime() + 50;
}
