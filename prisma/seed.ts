import { PrismaClient } from "@prisma/client";
import { randomBytes, scryptSync } from "node:crypto";
import { MISSING_DB_MESSAGE, applyPrismaEnv, isPostgresUrl } from "../src/lib/db-url";
import { FASE6_STOCK } from "../src/lib/isolated-demo";
import { isIsolatedPersistentUrl, looksLikeOliveProductionUrl } from "../src/lib/isolated-db-guard";

const db = applyPrismaEnv();
if (!db.configured || !db.url) {
  console.error(MISSING_DB_MESSAGE);
  process.exit(1);
}
if (process.env.MESA_ISOLATED_DEMO === "1") {
  if (looksLikeOliveProductionUrl(db.url)) {
    console.error("seed aislado abortado: la URI apunta a Café Ávila (olive).");
    process.exit(1);
  }
  if (isPostgresUrl(db.url) && !isIsolatedPersistentUrl(db.url)) {
    console.error("seed aislado abortado: Postgres debe ser mesa_isolated + schema isolated_fase6.");
    process.exit(1);
  }
}

const prisma = new PrismaClient({
  datasources: { db: { url: db.url } },
});

function hashPassword(password: string) {
  const salt = randomBytes(16).toString("hex");
  const hash = scryptSync(password, salt, 64).toString("hex");
  return `${salt}:${hash}`;
}

async function ensureFiscalV1() {
  const restaurant = await prisma.restaurant.findFirst();
  if (restaurant) {
    await prisma.restaurant.update({
      where: { id: restaurant.id },
      data: {
        igtfBancarizadoRate: restaurant.igtfBancarizadoRate ?? 0,
        igtfForexRate: restaurant.igtfForexRate || 3,
        fiscalAdapterMf: restaurant.fiscalAdapterMf || "DESCONECTADO",
        fiscalAdapterDigital: restaurant.fiscalAdapterDigital || "DESCONECTADO",
      },
    });
  }

  const extras = [
    { key: "CASHEA", label: "Cashea", currency: "VES", sortOrder: 8, hint: "Opcional — confirmación manual", igtfProfile: "BANCARIZADO", enabled: false },
    { key: "HOUSE_CREDIT", label: "Crédito casa", currency: "USD", sortOrder: 9, hint: "Cuenta de la casa — sin API", igtfProfile: "BANCARIZADO", enabled: true },
  ];
  for (const extra of extras) {
    await prisma.paymentMethod.upsert({
      where: { key: extra.key },
      create: extra,
      update: { label: extra.label, hint: extra.hint },
    });
  }

  const forex = ["CASH_USD", "ZELLE", "ZINLI"];
  const methods = await prisma.paymentMethod.findMany();
  for (const m of methods) {
    await prisma.paymentMethod.update({
      where: { id: m.id },
      data: { igtfProfile: forex.includes(m.key) ? "FOREX" : "BANCARIZADO" },
    });
  }

  const items = await prisma.item.findMany();
  for (const item of items) {
    let taxCode = "IVA16";
    let ivaRate = 16;
    if (item.name === "Agua mineral") {
      taxCode = "EXENTO";
      ivaRate = 0;
    }
    await prisma.item.update({ where: { id: item.id }, data: { taxCode, ivaRate } });
  }

  const purchases = await prisma.purchaseStub.count();
  if (purchases === 0) {
    await prisma.purchaseStub.createMany({
      data: [
        {
          supplierName: "Café Fama de América",
          supplierRif: "J-00011223-4",
          description: "Café en grano 5 kg",
          baseVes: 4500000,
          ivaVes: 720000,
          totalVes: 5220000,
          ivaRate: 16,
        },
        {
          supplierName: "Harinas del Alba",
          supplierRif: "J-00199887-1",
          description: "Harina de maíz precocida",
          baseVes: 2100000,
          ivaVes: 336000,
          totalVes: 2436000,
          ivaRate: 16,
        },
      ],
    });
  }
}

async function ensureIsolatedFase6Stock() {
  if (process.env.MESA_ISOLATED_DEMO !== "1") return;
  const item = await prisma.item.findFirst({ where: { name: FASE6_STOCK.itemName } });
  if (!item) return;
  if (item.stockControlled) {
    console.log(`Fase 6 aislada: ${item.name} ya controlado (${item.stockQty} ${item.stockUnit || FASE6_STOCK.unit}).`);
    return;
  }
  await prisma.item.update({
    where: { id: item.id },
    data: {
      stockControlled: true,
      stockQty: FASE6_STOCK.openingQty,
      stockUnit: FASE6_STOCK.unit,
      stockMinAlert: FASE6_STOCK.alertMin,
    },
  });
  console.log(`Fase 6 aislada: ${FASE6_STOCK.itemName} con ${FASE6_STOCK.openingQty} ${FASE6_STOCK.unit}.`);
}

async function main() {
  const existing = await prisma.restaurant.findFirst();
  if (existing) {
    await ensureFiscalV1();
    await ensureIsolatedFase6Stock();
    console.log("Semilla ya aplicada — Fiscal VE v1 sincronizado.");
    return;
  }

  const restaurant = await prisma.restaurant.create({
    data: {
      name: "Café Ávila",
      rif: "J-50392847-1",
      address: "Av. Francisco de Miranda, Los Palos Grandes, Caracas",
      phone: "+58 212 555 0142",
      ivaRate: 16,
      igtfBancarizadoRate: 0,
      igtfForexRate: 3,
      tipInTaxableBase: false,
      fiscalAdapterMf: "DESCONECTADO",
      fiscalAdapterDigital: "DESCONECTADO",
      bcvRate: 148.52,
      bcvUpdatedAt: new Date("2026-09-06T08:00:00-04:00"),
      bcvSource: "seed",
      folioSeq: 1,
    },
  });

  await prisma.rateLog.create({
    data: {
      rate: restaurant.bcvRate,
      source: "seed",
      fetchedAt: restaurant.bcvUpdatedAt,
    },
  });

  const users = [
    { email: "admin@mesa.ve", name: "Ana Rivas", role: "ADMIN" },
    { email: "cajero@mesa.ve", name: "Carlos Méndez", role: "CAJERO" },
    { email: "mesero@mesa.ve", name: "María Castillo", role: "MESERO" },
    { email: "cocina@mesa.ve", name: "José Altuve", role: "COCINA" },
  ];

  for (const u of users) {
    await prisma.user.create({
      data: {
        ...u,
        passwordHash: hashPassword("mesa123"),
      },
    });
  }

  const methods = [
    { key: "CASH_USD", label: "Efectivo USD", currency: "USD", sortOrder: 1, hint: "Billetes y monedas en dólares", igtfProfile: "FOREX" },
    { key: "CASH_VES", label: "Efectivo Bs", currency: "VES", sortOrder: 2, hint: "Bolívares en caja", igtfProfile: "BANCARIZADO" },
    { key: "PAGO_MOVIL", label: "Pago Móvil", currency: "VES", sortOrder: 3, hint: "Registro manual + referencia", igtfProfile: "BANCARIZADO" },
    { key: "TRANSFER", label: "Transferencia", currency: "VES", sortOrder: 4, hint: "Transferencia bancaria — confirmación manual", igtfProfile: "BANCARIZADO" },
    { key: "ZELLE", label: "Zelle", currency: "USD", sortOrder: 5, hint: "Registro manual + confirmación", igtfProfile: "FOREX" },
    { key: "BIOPAGO", label: "Biopago / Tarjeta", currency: "VES", sortOrder: 6, hint: "Punto de venta — confirmación manual", igtfProfile: "BANCARIZADO" },
    { key: "ZINLI", label: "Zinli", currency: "USD", sortOrder: 7, hint: "Billetera — registro manual", igtfProfile: "FOREX" },
    { key: "CASHEA", label: "Cashea", currency: "VES", sortOrder: 8, hint: "Opcional — confirmación manual", igtfProfile: "BANCARIZADO", enabled: false },
    { key: "HOUSE_CREDIT", label: "Crédito casa", currency: "USD", sortOrder: 9, hint: "Cuenta de la casa — sin API", igtfProfile: "BANCARIZADO" },
  ];

  for (const m of methods) {
    await prisma.paymentMethod.create({ data: m });
  }

  const plancha = await prisma.station.create({ data: { name: "Plancha", slug: "plancha", sortOrder: 1 } });
  const barra = await prisma.station.create({ data: { name: "Barra", slug: "barra", sortOrder: 2 } });
  const postres = await prisma.station.create({ data: { name: "Postres", slug: "postres", sortOrder: 3 } });

  const cats = {
    arepas: await prisma.category.create({ data: { name: "Arepas", sortOrder: 1 } }),
    empanadas: await prisma.category.create({ data: { name: "Empanadas", sortOrder: 2 } }),
    desayunos: await prisma.category.create({ data: { name: "Desayunos", sortOrder: 3 } }),
    especiales: await prisma.category.create({ data: { name: "Especiales", sortOrder: 4 } }),
    jugos: await prisma.category.create({ data: { name: "Jugos y bebidas", sortOrder: 5 } }),
    cafe: await prisma.category.create({ data: { name: "Café", sortOrder: 6 } }),
    dulces: await prisma.category.create({ data: { name: "Postres", sortOrder: 7 } }),
  };

  const items: Array<{
    name: string;
    description: string;
    priceUsd: number;
    categoryId: string;
    stationId: string;
    sortOrder: number;
    modifiers?: { name: string; priceUsd: number }[];
  }> = [
    {
      name: "Arepa Reina Pepiada",
      description: "Pollo, palta y mayonesa criolla",
      priceUsd: 650,
      categoryId: cats.arepas.id,
      stationId: plancha.id,
      sortOrder: 1,
      modifiers: [
        { name: "Extra queso", priceUsd: 80 },
        { name: "Sin cebolla", priceUsd: 0 },
        { name: "Picante", priceUsd: 0 },
      ],
    },
    {
      name: "Arepa Pelúa",
      description: "Carne mechada y queso gouda",
      priceUsd: 680,
      categoryId: cats.arepas.id,
      stationId: plancha.id,
      sortOrder: 2,
      modifiers: [
        { name: "Extra carne", priceUsd: 150 },
        { name: "Extra queso", priceUsd: 80 },
      ],
    },
    {
      name: "Arepa Dominó",
      description: "Caraotas negras y queso blanco",
      priceUsd: 520,
      categoryId: cats.arepas.id,
      stationId: plancha.id,
      sortOrder: 3,
      modifiers: [{ name: "Queso extra", priceUsd: 80 }],
    },
    {
      name: "Arepa de Perico",
      description: "Huevos revueltos criollos",
      priceUsd: 480,
      categoryId: cats.arepas.id,
      stationId: plancha.id,
      sortOrder: 4,
    },
    {
      name: "Arepa de Queso",
      description: "Queso de mano derretido",
      priceUsd: 420,
      categoryId: cats.arepas.id,
      stationId: plancha.id,
      sortOrder: 5,
    },
    {
      name: "Empanada de Carne",
      description: "Carne mechada, masa de maíz",
      priceUsd: 380,
      categoryId: cats.empanadas.id,
      stationId: plancha.id,
      sortOrder: 1,
      modifiers: [{ name: "Con queso", priceUsd: 60 }],
    },
    {
      name: "Empanada de Queso",
      description: "Queso llanero",
      priceUsd: 320,
      categoryId: cats.empanadas.id,
      stationId: plancha.id,
      sortOrder: 2,
    },
    {
      name: "Empanada de Cazón",
      description: "Clásica de Oriente",
      priceUsd: 450,
      categoryId: cats.empanadas.id,
      stationId: plancha.id,
      sortOrder: 3,
    },
    {
      name: "Tequeños (6 und)",
      description: "Palitos de queso fritos",
      priceUsd: 550,
      categoryId: cats.empanadas.id,
      stationId: plancha.id,
      sortOrder: 4,
      modifiers: [{ name: "Salsa guasacaca", priceUsd: 40 }],
    },
    {
      name: "Cachapa con Queso",
      description: "Maíz tierno y queso de mano",
      priceUsd: 780,
      categoryId: cats.desayunos.id,
      stationId: plancha.id,
      sortOrder: 1,
      modifiers: [
        { name: "Con pernil", priceUsd: 250 },
        { name: "Doble queso", priceUsd: 120 },
      ],
    },
    {
      name: "Desayuno Criollo",
      description: "Arepa, caraotas, huevo y queso",
      priceUsd: 890,
      categoryId: cats.desayunos.id,
      stationId: plancha.id,
      sortOrder: 2,
    },
    {
      name: "Pabellón Criollo",
      description: "Carne, caraotas, arroz y tajadas",
      priceUsd: 1250,
      categoryId: cats.especiales.id,
      stationId: plancha.id,
      sortOrder: 1,
      modifiers: [
        { name: "Sin tajadas", priceUsd: 0 },
        { name: "Extra carne", priceUsd: 250 },
      ],
    },
    {
      name: "Asado Negro",
      description: "Con arroz y ensalada",
      priceUsd: 1380,
      categoryId: cats.especiales.id,
      stationId: plancha.id,
      sortOrder: 2,
    },
    {
      name: "Jugo de Parchita",
      description: "Natural, vaso 400 ml",
      priceUsd: 280,
      categoryId: cats.jugos.id,
      stationId: barra.id,
      sortOrder: 1,
      modifiers: [{ name: "Con hielo", priceUsd: 0 }],
    },
    {
      name: "Jugo de Mango",
      description: "Natural, vaso 400 ml",
      priceUsd: 280,
      categoryId: cats.jugos.id,
      stationId: barra.id,
      sortOrder: 2,
    },
    {
      name: "Papelón con Limón",
      description: "Tradicional, jarra individual",
      priceUsd: 220,
      categoryId: cats.jugos.id,
      stationId: barra.id,
      sortOrder: 3,
    },
    {
      name: "Cerveza Polar",
      description: "Botella 222 ml",
      priceUsd: 250,
      categoryId: cats.jugos.id,
      stationId: barra.id,
      sortOrder: 4,
    },
    {
      name: "Agua mineral",
      description: "500 ml",
      priceUsd: 150,
      categoryId: cats.jugos.id,
      stationId: barra.id,
      sortOrder: 5,
    },
    {
      name: "Café Negro",
      description: "Guayoyo",
      priceUsd: 180,
      categoryId: cats.cafe.id,
      stationId: barra.id,
      sortOrder: 1,
    },
    {
      name: "Café con Leche",
      description: "Taza grande",
      priceUsd: 220,
      categoryId: cats.cafe.id,
      stationId: barra.id,
      sortOrder: 2,
    },
    {
      name: "Quesillo",
      description: "Porción casera",
      priceUsd: 420,
      categoryId: cats.dulces.id,
      stationId: postres.id,
      sortOrder: 1,
    },
    {
      name: "Torta Tres Leches",
      description: "Porción",
      priceUsd: 480,
      categoryId: cats.dulces.id,
      stationId: postres.id,
      sortOrder: 2,
    },
  ];

  for (const item of items) {
    const { modifiers, ...data } = item;
    const created = await prisma.item.create({ data });
    if (modifiers) {
      for (const mod of modifiers) {
        await prisma.modifier.create({ data: { ...mod, itemId: created.id } });
      }
    }
  }

  const tables: { number: string; seats: number; zone: string; posX: number; posY: number }[] = [
    { number: "1", seats: 2, zone: "Salón", posX: 1, posY: 1 },
    { number: "2", seats: 2, zone: "Salón", posX: 2, posY: 1 },
    { number: "3", seats: 4, zone: "Salón", posX: 3, posY: 1 },
    { number: "4", seats: 4, zone: "Salón", posX: 1, posY: 2 },
    { number: "5", seats: 4, zone: "Salón", posX: 2, posY: 2 },
    { number: "6", seats: 6, zone: "Salón", posX: 3, posY: 2 },
    { number: "7", seats: 4, zone: "Salón", posX: 1, posY: 3 },
    { number: "8", seats: 8, zone: "Salón", posX: 2, posY: 3 },
    { number: "9", seats: 4, zone: "Terraza", posX: 1, posY: 1 },
    { number: "10", seats: 4, zone: "Terraza", posX: 2, posY: 1 },
    { number: "11", seats: 2, zone: "Terraza", posX: 1, posY: 2 },
    { number: "12", seats: 6, zone: "Terraza", posX: 2, posY: 2 },
    { number: "B1", seats: 2, zone: "Barra", posX: 1, posY: 1 },
    { number: "B2", seats: 2, zone: "Barra", posX: 2, posY: 1 },
    { number: "B3", seats: 2, zone: "Barra", posX: 3, posY: 1 },
    { number: "B4", seats: 2, zone: "Barra", posX: 4, posY: 1 },
  ];

  for (const t of tables) {
    await prisma.diningTable.create({ data: t });
  }

  if (process.env.MESA_ISOLATED_DEMO === "1") {
    await ensureIsolatedFase6Stock();
  }

  await ensureFiscalV1();
  console.log("Semilla lista: Café Ávila + Fiscal VE v1.");
}

main()
  .then(() => prisma.$disconnect())
  .catch(async (e) => {
    console.error(e);
    await prisma.$disconnect();
    process.exit(1);
  });
