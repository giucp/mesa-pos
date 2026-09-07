"use client";

import { useEffect, useState } from "react";
import { cn } from "@/lib/utils";
import { QUEUE_EVENT, queueSnapshot } from "@/lib/offline-queue";
import { deriveSyncState, type SyncView } from "@/lib/sync-state";

export function StatusChip() {
  const [view, setView] = useState<SyncView>({ label: "Al día", tone: "ready", pending: 0 });

  useEffect(() => {
    const refresh = () => {
      queueSnapshot()
        .then((snap) =>
          setView(
            deriveSyncState({
              online: navigator.onLine,
              pending: snap.unsynced,
              errors: snap.errors,
            }),
          ),
        )
        .catch(() =>
          setView(deriveSyncState({ online: navigator.onLine, pending: 0, errors: 0 })),
        );
    };
    refresh();
    window.addEventListener("online", refresh);
    window.addEventListener("offline", refresh);
    window.addEventListener(QUEUE_EVENT, refresh);
    const tick = window.setInterval(refresh, 4000);
    return () => {
      window.removeEventListener("online", refresh);
      window.removeEventListener("offline", refresh);
      window.removeEventListener(QUEUE_EVENT, refresh);
      window.clearInterval(tick);
    };
  }, []);

  const count = view.pending > 0 ? ` · ${view.pending}` : "";
  return (
    <span
      title={
        view.pending
          ? `${view.pending} operaciones pendientes. Tener internet no significa que el servidor ya guardó el cambio.`
          : "Cola offline de Mesa. Al día = el servidor confirmó lo enviado."
      }
      className={cn(
        "inline-flex min-h-8 items-center rounded-full px-2.5 text-[11px] font-semibold",
        view.tone === "offline" && "bg-destructive/20 text-destructive",
        view.tone === "error" && "bg-destructive/20 text-destructive",
        view.tone === "syncing" && "bg-busy/20 text-busy-foreground",
        view.tone === "ready" && "bg-free/20 text-free-foreground",
      )}
    >
      <span
        className={cn(
          "mr-1.5 size-1.5 rounded-full",
          view.tone === "offline" || view.tone === "error" ? "bg-destructive" : view.tone === "syncing" ? "bg-busy" : "bg-free",
        )}
      />
      {view.label}
      {count}
    </span>
  );
}
