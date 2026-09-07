"use client";

import { useEffect } from "react";
import { addItemAction, sendToKitchenAction } from "@/actions/orders";
import { openTableAction } from "@/actions/tables";
import { bumpTicketAction, recallTicketAction } from "@/actions/kitchen";
import { addPaymentAction, verifyPaymentStatusAction } from "@/actions/payments";
import { CONFLICT_EVENT, listJobs, removeJob, updateJob, type QueueJob } from "@/lib/offline-queue";
import { printTicketNow, type PrintTicket } from "@/lib/print-tickets";
import { isServerOnlyAction } from "@/lib/sync-state";

async function replay(job: QueueJob) {
  const p = job.payload;
  switch (job.action) {
    case "openTable":
      return openTableAction(String(p.tableId), Number(p.guestCount ?? 2));
    case "addItem":
      return addItemAction(
        String(p.checkId),
        String(p.itemId),
        (p.modifierIds as string[]) ?? [],
        String(p.notes ?? ""),
        {
          qty: typeof p.qty === "number" ? p.qty : 1,
          clientOpId: String(p.clientOpId ?? job.id),
          knownLineIds: Array.isArray(p.knownLineIds) ? (p.knownLineIds as string[]) : undefined,
          baseUpdatedAt: typeof p.baseUpdatedAt === "string" ? p.baseUpdatedAt : undefined,
        },
      );
    case "sendKitchen":
      return sendToKitchenAction(String(p.checkId));
    case "bump":
      return bumpTicketAction(String(p.checkId), String(p.stationId));
    case "recall":
      return recallTicketAction(String(p.checkId), String(p.stationId));
    case "addPayment": {
      const opId = String(p.idempotencyKey ?? job.id);
      const status = await verifyPaymentStatusAction(String(p.checkId), opId);
      if (!("error" in status && status.error) && status.status !== "unknown") {
        return { ok: true, duplicate: true, paymentId: status.paymentId };
      }
      return addPaymentAction({
        ...(p as Parameters<typeof addPaymentAction>[0]),
        idempotencyKey: opId,
      });
    }
    case "print":
      return printTicketNow(p as unknown as PrintTicket);
    default:
      return { error: "Acción de cola desconocida." };
  }
}

export function OfflineSync() {
  useEffect(() => {
    let busy = false;
    async function flush() {
      if (busy || !navigator.onLine) return;
      busy = true;
      try {
        const jobs = await listJobs();
        for (const job of jobs) {
          if (isServerOnlyAction(job.action)) {
            await updateJob(job.id, {
              status: "error",
              error: "Esta operación no se confirma sin respuesta del servidor.",
            });
            continue;
          }
          await updateJob(job.id, { status: "syncing", attempts: job.attempts + 1 });
          try {
            const res = (await replay(job)) as {
              error?: string;
              conflict?: boolean;
              server?: unknown;
            };
            if (res?.conflict) {
              await updateJob(job.id, { status: "error", error: res.error ?? "Conflicto" });
              window.dispatchEvent(
                new CustomEvent(CONFLICT_EVENT, { detail: { jobId: job.id, server: res.server } }),
              );
              continue;
            }
            if (res?.error) {
              await updateJob(job.id, { status: "error", error: res.error });
            } else {
              await removeJob(job.id);
            }
          } catch (error) {
            await updateJob(job.id, {
              status: "error",
              error: error instanceof Error ? error.message : "Falló la sincronización",
            });
          }
        }
      } finally {
        busy = false;
      }
    }
    flush();
    window.addEventListener("online", flush);
    const tick = window.setInterval(flush, 8000);
    return () => {
      window.removeEventListener("online", flush);
      window.clearInterval(tick);
    };
  }, []);
  return null;
}
