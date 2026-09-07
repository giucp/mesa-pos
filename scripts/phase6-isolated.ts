/**
 * Isolated Fase 6 demo stock. Refuses production. Does not invent olive sales.
 */
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { FASE6_STOCK } from "../src/lib/isolated-demo";

import { isolatedPrisma } from "./isolated-target";

const prisma = isolatedPrisma("phase6-isolated");

async function main() {
  const item = await prisma.item.findFirst({ where: { name: FASE6_STOCK.itemName } });
  assert.ok(item, `Falta ${FASE6_STOCK.itemName} en el demo aislado`);
  await prisma.item.update({
    where: { id: item.id },
    data: {
      stockControlled: true,
      stockQty: item.stockControlled ? item.stockQty : FASE6_STOCK.openingQty,
      stockUnit: FASE6_STOCK.unit,
      stockMinAlert: FASE6_STOCK.alertMin,
    },
  });
  const fresh = await prisma.item.findUnique({ where: { id: item.id } });
  assert.ok(fresh?.stockControlled);
  const note = {
    item: FASE6_STOCK.itemName,
    stockQty: fresh.stockQty,
    unit: fresh.stockUnit,
    alertMin: fresh.stockMinAlert,
    rule: "Reserva al agregar. Anular después de ENVIAR COCINA no devuelve comida preparada.",
  };
  fs.writeFileSync(path.join(process.cwd(), "prisma", "fase6-evidence.json"), JSON.stringify(note, null, 2));
  console.log(JSON.stringify(note));
}

main()
  .then(() => prisma.$disconnect())
  .catch(async (e) => {
    console.error(e);
    await prisma.$disconnect();
    process.exit(1);
  });
