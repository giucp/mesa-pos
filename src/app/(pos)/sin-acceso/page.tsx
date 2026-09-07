import Link from "next/link";
import { requireUser } from "@/lib/auth-guard";
import { homePath } from "@/lib/roles";

export default async function UnauthorizedPage() {
  const user = await requireUser();
  return (
    <div className="flex h-full flex-col items-center justify-center gap-3 p-8 text-center">
      <h1 className="text-lg font-semibold">Sin permiso para esta pantalla</h1>
      <p className="max-w-md text-sm text-muted-foreground">
        Tu usuario está en turno, pero este rol no abre esa sección. No se cerró la sesión.
      </p>
      <Link
        href={homePath(user.role)}
        className="min-h-11 rounded-xl bg-primary px-4 py-3 text-sm font-medium text-primary-foreground"
      >
        Volver
      </Link>
    </div>
  );
}
