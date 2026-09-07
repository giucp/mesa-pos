import { LoginForm } from "@/components/pos/login-form";
import { OfflineSync } from "@/components/pos/offline-sync";
import { StatusChip } from "@/components/pos/status-chip";
import { ThemeToggle } from "@/components/pos/theme-toggle";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { isDatabaseConfigured, MISSING_DB_MESSAGE } from "@/lib/db-url";
import { getSession } from "@/lib/session";
import { homePath } from "@/lib/roles";
import { safeNextPath } from "@/lib/safe-next";
import { ISOLATED_DEMO, FASE2_FOLIOS } from "@/lib/isolated-demo";
import { redirect } from "next/navigation";
import Link from "next/link";

export const dynamic = "force-dynamic";

export default async function LoginPage({
  searchParams,
}: {
  searchParams: Promise<{ next?: string; aviso?: string }>;
}) {
  const query = await searchParams;
  const next = safeNextPath(query.next);
  const session = await getSession();
  if (session) redirect(next ?? homePath(session.role));
  const dbReady = isDatabaseConfigured();

  return (
    <div className="relative flex min-h-dvh items-center justify-center overflow-hidden px-4 py-10">
      <OfflineSync />
      <div className="absolute right-4 top-4 z-10 flex items-center gap-2">
        <StatusChip />
        <ThemeToggle />
      </div>
      <div className="pointer-events-none absolute inset-0 bg-[radial-gradient(ellipse_at_top,_oklch(0.35_0.06_70/_0.35),_transparent_55%)]" />
      <div className="relative grid w-full max-w-5xl gap-10 lg:grid-cols-[1.1fr_0.9fr] lg:items-center">
        <div className="space-y-5">
          <div className="inline-flex items-center gap-2 rounded-full border border-primary/30 bg-primary/10 px-3 py-1 text-xs font-medium text-primary">
            Mesa · POS VE
          </div>
          <h1 className="max-w-lg text-4xl font-semibold tracking-tight md:text-5xl">
            El salón, la cocina y la caja en un solo ritmo.
          </h1>
          <p className="max-w-md text-muted-foreground">
            Hecho para Caracas y el resto del país: USD y bolívares en la misma cuenta, tasa BCV del
            día, Pago Móvil y Zelle como métodos de verdad — con confirmación manual honesta.
          </p>
          <ul className="grid max-w-md gap-2 text-sm text-muted-foreground">
            <li>— Abre mesa, agrega arepa, envía a cocina, cobra. Dos toques.</li>
            <li>— Cocina por estación. Vuelto en la otra moneda.</li>
            <li>— Comprobante interno con RIF, IVA e IGTF. El PDF de Mesa no es documento fiscal SENIAT.</li>
          </ul>
        </div>
        <div className="rounded-3xl border border-border bg-card/80 p-6 shadow-2xl backdrop-blur">
          <div className="mb-5">
            <h2 className="text-xl font-semibold">Entrar al turno</h2>
            <p className="text-sm text-muted-foreground">
              {ISOLATED_DEMO
                ? "Entorno aislado Fase 2 — no es Café Ávila producción"
                : "Café Ávila · demo lista para usar"}
            </p>
          </div>
          {ISOLATED_DEMO ? (
            <Alert className="mb-4">
              <AlertDescription>
                Ventas de evidencia: {FASE2_FOLIOS.A}, {FASE2_FOLIOS.B}, {FASE2_FOLIOS.C}. PIN 1111.{" "}
                <Link className="underline" href="/evidencia">
                  Ver tabla
                </Link>
                {" · "}
                <Link className="underline" href="/reports/day">
                  Caja
                </Link>
                . Comprobante interno — no es documento fiscal SENIAT.
              </AlertDescription>
            </Alert>
          ) : null}
          {query.aviso === "sesion" ? (
            <Alert className="mb-4">
              <AlertDescription>
                Tu turno se cerró o la sesión no llegó a esta pestaña. Entra de nuevo y vuelves a
                {next ? " la pantalla anterior." : " tu pantalla de inicio."}
              </AlertDescription>
            </Alert>
          ) : null}
          {dbReady ? null : (
            <Alert variant="destructive" className="mb-4">
              <AlertDescription>{MISSING_DB_MESSAGE}</AlertDescription>
            </Alert>
          )}
          <LoginForm next={next} />
        </div>
      </div>
    </div>
  );
}
