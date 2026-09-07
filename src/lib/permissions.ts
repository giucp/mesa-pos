import { can, type Action, type SessionUser } from "@/lib/roles";

export const SESSION_ERROR = "Sesión vencida.";
export const PERMISSION_ERROR = "No tienes permiso para esta operación.";
export const MOTIVO_ERROR = "Esta operación exige autorización de Administración y un motivo.";

export type AuthResult =
  | { ok: true; user: SessionUser; error?: undefined }
  | { ok: false; error: string; user?: undefined };

export type MotivoResult =
  | { ok: true; reason: string; error?: undefined }
  | { ok: false; error: string; reason?: undefined };

export function authorize(user: SessionUser | null | undefined, action: Action): AuthResult {
  if (!user) return { ok: false, error: SESSION_ERROR };
  if (!can(user.role, action)) return { ok: false, error: PERMISSION_ERROR };
  return { ok: true, user };
}

export function requireMotivo(reason: string | undefined | null): MotivoResult {
  const text = (reason ?? "").trim();
  if (text.length < 3) return { ok: false, error: MOTIVO_ERROR };
  return { ok: true, reason: text };
}
