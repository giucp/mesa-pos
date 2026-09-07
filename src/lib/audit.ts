import { prisma } from "@/lib/db";
import { auditDetails } from "@/lib/audit-shape";

export { auditDetails };

export async function writeAudit(input: {
  action: string;
  reason: string;
  userId?: string | null;
  checkId?: string | null;
  details?: string;
}) {
  return prisma.auditLog.create({
    data: {
      action: input.action,
      reason: input.reason.trim(),
      userId: input.userId ?? null,
      checkId: input.checkId ?? null,
      details: input.details ?? "",
    },
  });
}
