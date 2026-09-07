import { Badge } from "@/components/ui/badge";
import { ROLE_LABEL, type Role } from "@/lib/roles";

export function StaffBoard({
  users,
}: {
  users: { id: string; name: string; email: string; role: Role; active: boolean; pin: string | null }[];
}) {
  return (
    <div className="space-y-4 p-4">
      <div>
        <h1 className="text-lg font-semibold">Equipo</h1>
        <p className="text-sm text-muted-foreground">
          Un local. PIN demo de 4 dígitos o clave <span className="font-mono">mesa123</span>. Nómina fuera de MVP.
        </p>
      </div>
      {users.length === 0 ? (
        <div className="rounded-2xl border border-dashed border-border px-4 py-12 text-center text-sm text-muted-foreground">
          No hay usuarios. Ejecuta npm run db:seed.
        </div>
      ) : (
        <div className="grid gap-3 md:grid-cols-2">
          {users.map((u) => (
            <div key={u.id} className="rounded-2xl border border-border bg-card p-4">
              <div className="flex items-start justify-between gap-2">
                <div>
                  <div className="text-lg font-semibold">{u.name}</div>
                  <div className="text-sm text-muted-foreground">{u.email}</div>
                </div>
                <Badge variant={u.active ? "secondary" : "outline"}>{ROLE_LABEL[u.role]}</Badge>
              </div>
              <div className="mt-3 text-sm">
                PIN demo:{" "}
                <span className="font-mono text-base font-semibold">{u.pin ?? "—"}</span>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
