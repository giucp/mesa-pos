"use client";

import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import type { ServerCheckSnapshot } from "@/lib/sync-state";

export function SyncConflictDialog({
  open,
  local,
  server,
  onUseServer,
  onSendMine,
}: {
  open: boolean;
  local: { name: string; qty: number; notes?: string | null; placeLabel?: string };
  server: ServerCheckSnapshot | null;
  onUseServer: () => void;
  onSendMine: () => void;
}) {
  return (
    <Dialog open={open} onOpenChange={(next) => (!next ? onUseServer() : undefined)}>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle>Conflicto en la cuenta</DialogTitle>
        </DialogHeader>
        <p className="text-sm text-muted-foreground">
          Otra sesión cambió {server?.folio ?? "esta cuenta"}. No se pisó el pedido. Elige cómo
          resolver.
        </p>
        <div className="grid gap-3 text-sm sm:grid-cols-2">
          <div className="rounded-xl border border-border p-3">
            <p className="font-medium">En el servidor</p>
            {server?.lines.length ? (
              <ul className="mt-2 space-y-1 text-muted-foreground">
                {server.lines.map((l) => (
                  <li key={l.id}>
                    {l.qty}× {l.name}
                    {l.notes ? ` · ${l.notes}` : ""}
                  </li>
                ))}
              </ul>
            ) : (
              <p className="mt-2 text-muted-foreground">Sin platos en el servidor.</p>
            )}
          </div>
          <div className="rounded-xl border border-border p-3">
            <p className="font-medium">Tu cambio pendiente</p>
            <p className="mt-2 text-muted-foreground">
              {local.qty}× {local.name}
              {local.notes ? ` · ${local.notes}` : ""}
              {local.placeLabel ? ` · ${local.placeLabel}` : ""}
            </p>
          </div>
        </div>
        <div className="flex flex-col gap-2 sm:flex-row">
          <Button className="flex-1" variant="secondary" onClick={onUseServer}>
            Quedarme con el servidor
          </Button>
          <Button className="flex-1" onClick={onSendMine}>
            Enviar mi plato de todos modos
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
