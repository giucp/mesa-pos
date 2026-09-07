"use client";

import { useState } from "react";
import { Button } from "@/components/ui/button";
import { FISCAL_COPY } from "@/lib/fiscal";
import { queueAndPrint, type PrintTicket } from "@/lib/print-tickets";

export function PrintStub({
  label = "Imprimir ticket",
  ticket,
}: {
  label?: string;
  ticket?: PrintTicket;
}) {
  const [msg, setMsg] = useState<string | null>(null);
  return (
    <div>
      <Button
        type="button"
        variant="secondary"
        className="min-h-12 w-full"
        onClick={async () => {
          const payload: PrintTicket = ticket ?? {
            type: "recibo",
            folio: "PRUEBA",
            lines: [{ qty: 1, name: "Ticket de prueba" }],
            footer: FISCAL_COPY.footerInternal,
          };
          const res = await queueAndPrint(payload);
          setMsg(
            res.ok
              ? "En cola de impresión. Si no salió, revisa el diálogo del navegador."
              : (res.error ?? "Impresora no conectada. La cola del navegador no es un medio fiscal SENIAT."),
          );
        }}
      >
        {label}
      </Button>
      {msg ? <p className="mt-2 text-center text-[11px] text-muted-foreground">{msg}</p> : null}
    </div>
  );
}
