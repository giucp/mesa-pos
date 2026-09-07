import { InventoryDesk } from "@/components/pos/inventory-desk";
import { requireAction } from "@/lib/auth-guard";
import { prisma } from "@/lib/db";
import { ISOLATED_DEMO } from "@/lib/isolated-demo";

export const dynamic = "force-dynamic";

export default async function InventarioPage() {
  await requireAction("menu");
  if (!ISOLATED_DEMO) {
    return (
      <div className="mx-auto max-w-xl p-8">
        <h1 className="text-lg font-semibold">Inventario</h1>
        <p className="mt-2 text-sm text-muted-foreground">
          El control de producto terminado (Fase 6) está en el demo aislado para revisión de Giucp.
          Producción Café Ávila aún no lo publica.
        </p>
      </div>
    );
  }

  const [items, moves] = await Promise.all([
    prisma.item.findMany({
      orderBy: [{ sortOrder: "asc" }, { name: "asc" }],
      select: {
        id: true,
        name: true,
        available: true,
        stockControlled: true,
        stockQty: true,
        stockUnit: true,
        stockMinAlert: true,
      },
    }),
    prisma.stockMovement.findMany({
      orderBy: { createdAt: "desc" },
      take: 80,
      include: { item: { select: { name: true } } },
    }),
  ]);

  return (
    <InventoryDesk
      items={items}
      moves={moves.map((m) => ({
        id: m.id,
        type: m.type,
        qty: m.qty,
        unit: m.unit,
        motivo: m.motivo,
        userName: m.userName,
        createdAt: m.createdAt.toISOString(),
        itemName: m.item.name,
      }))}
    />
  );
}
