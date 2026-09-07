import { requireAction } from "@/lib/auth-guard";
import { prisma } from "@/lib/db";
import { ROLE_LABEL, type Role } from "@/lib/roles";
import { auditHeadline, auditRawLines, parseAuditDetails } from "@/lib/audit-display";

export const dynamic = "force-dynamic";

export default async function AuditoriaPage() {
  await requireAction("audit");
  const [rows, users] = await Promise.all([
    prisma.auditLog.findMany({ orderBy: { createdAt: "desc" }, take: 200 }),
    prisma.user.findMany({ select: { id: true, name: true, role: true } }),
  ]);
  const byId = new Map(users.map((u) => [u.id, u]));

  return (
    <div className="mx-auto max-w-4xl space-y-4 p-4 pb-16">
      <div>
        <h1 className="text-lg font-semibold">Auditoría</h1>
        <p className="text-sm text-muted-foreground">
          Bitácora de solo lectura. Quién, qué, cuándo, cuenta o producto, motivo y montos en
          lenguaje claro. Códigos, JSON y céntimos internos van en el detalle plegable. No se
          edita ni se borra desde el POS.
        </p>
      </div>
      {rows.length === 0 ? (
        <p className="rounded-2xl border border-dashed border-border px-4 py-10 text-center text-sm text-muted-foreground">
          Aún no hay movimientos auditados.
        </p>
      ) : (
        <div className="overflow-x-auto rounded-2xl border border-border">
          <table className="w-full text-left text-sm">
            <thead>
              <tr className="border-b border-border text-muted-foreground">
                <th className="px-3 py-2">Cuándo</th>
                <th className="px-3 py-2">Quién</th>
                <th className="px-3 py-2">Qué</th>
                <th className="px-3 py-2">Motivo</th>
                <th className="px-3 py-2">Detalle</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((row) => {
                const who = row.userId ? byId.get(row.userId) : null;
                const payload = parseAuditDetails(row.details);
                const headline = auditHeadline(row.action, payload);
                const raw = auditRawLines(row.action, payload, row.details || "");
                return (
                  <tr key={row.id} className="border-b border-border align-top">
                    <td className="whitespace-nowrap px-3 py-2 tabular-nums text-muted-foreground">
                      {row.createdAt.toLocaleString("es-VE")}
                    </td>
                    <td className="px-3 py-2">
                      {who
                        ? `${who.name} · ${ROLE_LABEL[who.role as Role] ?? who.role}`
                        : "Sistema"}
                    </td>
                    <td className="px-3 py-2 font-medium">{headline}</td>
                    <td className="px-3 py-2">{row.reason}</td>
                    <td className="max-w-xs px-3 py-2 text-xs text-muted-foreground">
                      <details>
                        <summary className="cursor-pointer select-none text-foreground/80">
                          Códigos y JSON
                        </summary>
                        <pre className="mt-2 overflow-x-auto whitespace-pre-wrap rounded-lg bg-muted/50 p-2 text-[11px]">
                          {raw}
                        </pre>
                      </details>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
