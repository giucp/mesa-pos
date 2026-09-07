import { StaffBoard } from "@/components/pos/staff-board";
import { requireAction } from "@/lib/auth-guard";
import { prisma } from "@/lib/db";
import { DEMO_PINS } from "@/lib/paths";
import type { Role } from "@/lib/roles";

export default async function StaffPage() {
  await requireAction("staff");
  const users = await prisma.user.findMany({ orderBy: { createdAt: "asc" } });
  const pinByEmail = Object.fromEntries(
    Object.entries(DEMO_PINS).map(([pin, email]) => [email, pin]),
  );

  return (
    <StaffBoard
      users={users.map((u) => ({
        id: u.id,
        name: u.name,
        email: u.email,
        role: u.role as Role,
        active: u.active,
        pin: pinByEmail[u.email] ?? null,
      }))}
    />
  );
}
