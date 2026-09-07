import { FiscalView } from "@/components/pos/fiscal-view";
import { ReportsView } from "@/components/pos/reports-view";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { requireAction } from "@/lib/auth-guard";
import { can } from "@/lib/roles";
import { getBcvRate } from "@/lib/bcv";
import { listOpenChecks } from "@/lib/open-checks";
import { getAssignableStaff, getOpenChecks, getRestaurant, startOfBusinessDay } from "@/lib/queries";
import { prisma } from "@/lib/db";
import { fiscalTotals } from "@/lib/fiscal";
import { summarizePayments } from "@/lib/caja";

export default async function ReportsDayPage() {
  const user = await requireAction("reports");
  const from = startOfBusinessDay();
  const [restaurant, rate, paid, voids, rawOpen, audits, drafts, staff] = await Promise.all([
    getRestaurant(),
    getBcvRate(),
    prisma.check.findMany({
      where: { status: { in: ["PAID", "CLOSED"] }, closedAt: { gte: from } },
      include: { lines: true, payments: true },
    }),
    prisma.check.findMany({
      where: { status: "VOID", voidedAt: { gte: from } },
      include: { lines: true },
    }),
    getOpenChecks(),
    prisma.auditLog.findMany({
      where: { createdAt: { gte: from }, action: { in: ["DISCOUNT", "COURTESY"] } },
    }),
    prisma.fiscalDraft.findMany({
      where: { createdAt: { gte: from } },
      include: { check: { include: { table: true } } },
      orderBy: { createdAt: "desc" },
    }),
    getAssignableStaff(),
  ]);
  const openChecks = listOpenChecks(rawOpen, restaurant.ivaRate);

  let salesUsd = 0;
  let ivaUsd = 0;
  let tipUsd = 0;
  let igtfUsd = 0;
  let expectedVes = 0;
  const methodMap = new Map<
    string,
    {
      key: string;
      label: string;
      count: number;
      usd: number;
      ves: number;
      nativeUsd: number;
      nativeVes: number;
      igtfUsd: number;
      verified: number;
      pendingCount: number;
      pendingUsd: number;
    }
  >();
  const currMap = new Map<string, { currency: string; count: number; native: number; usd: number }>();
  const channelMap = new Map<string, { channel: string; count: number; usd: number }>();
  let rateDeltaVes = 0;
  let cashUsd = 0;
  let cashVes = 0;
  let pendingUsd = 0;
  let collectedVes = 0;

  for (const c of paid) {
    const ticketRate = c.bcvRateUsed || rate.usdToVes;
    const t = fiscalTotals(c.lines, c.tipUsd, restaurant.ivaRate, ticketRate, restaurant.tipInTaxableBase);
    salesUsd += t.subtotalUsd;
    ivaUsd += t.ivaUsd;
    tipUsd += t.tipUsd;
    expectedVes += t.totalVes;
    const ch = channelMap.get(c.channel) ?? { channel: c.channel, count: 0, usd: 0 };
    ch.count += 1;
    ch.usd += t.totalUsd;
    channelMap.set(c.channel, ch);
    const caja = summarizePayments(c.payments, ticketRate);
    igtfUsd += caja.igtfUsd;
    pendingUsd += caja.pendingUsd;
    cashUsd += caja.cashUsd;
    cashVes += caja.cashVes;
    rateDeltaVes += caja.rateDeltaVes;
    collectedVes += caja.collectedVes;
    for (const [key, m] of caja.methodMap) {
      const acc = methodMap.get(key) ?? {
        key: m.key,
        label: m.label,
        count: 0,
        usd: 0,
        ves: 0,
        nativeUsd: 0,
        nativeVes: 0,
        igtfUsd: 0,
        verified: 0,
        pendingCount: 0,
        pendingUsd: 0,
      };
      acc.count += m.count;
      acc.usd += m.usd;
      acc.ves += m.ves;
      acc.nativeUsd += m.nativeUsd;
      acc.nativeVes += m.nativeVes;
      acc.igtfUsd += m.igtfUsd;
      acc.verified += m.verified;
      acc.pendingCount += m.pendingCount;
      acc.pendingUsd += m.pendingUsd;
      methodMap.set(key, acc);
    }
    for (const [key, cur] of caja.currMap) {
      const acc = currMap.get(key) ?? { currency: cur.currency, count: 0, native: 0, usd: 0 };
      acc.count += cur.count;
      acc.native += cur.native;
      acc.usd += cur.usd;
      currMap.set(key, acc);
    }
  }
  const voidUsd = voids.reduce((s, c) => s + fiscalTotals(c.lines, 0, restaurant.ivaRate).totalUsd, 0);
  const openUsd = openChecks.reduce((s, c) => s + c.remainingUsd, 0);

  return (
    <Tabs defaultValue="caja" className="p-4">
      <TabsList>
        <TabsTrigger value="caja">Caja y reportes</TabsTrigger>
        <TabsTrigger value="fiscal">Comprobantes internos</TabsTrigger>
      </TabsList>
      <TabsContent value="caja">
        <ReportsView
          rate={rate.usdToVes}
          rateSource={rate.source}
          canVoid={can(user.role, "void")}
          summary={{
            salesUsd,
            ivaUsd,
            tipUsd,
            igtfUsd,
            voids: voids.length,
            voidUsd,
            discounts: audits.filter((a) => a.action === "DISCOUNT").length,
            courtesies: audits.filter((a) => a.action === "COURTESY").length,
            openTables: openChecks.length,
            openUsd,
            openChecks,
            staff: staff.map((u) => ({ id: u.id, name: u.name })),
            expectedVes,
            collectedVes,
            rateDeltaVes,
            cashUsd,
            cashVes,
            pendingUsd,
            byMethod: Array.from(methodMap.values()),
            byCurrency: Array.from(currMap.values()),
            byChannel: Array.from(channelMap.values()),
          }}
        />
      </TabsContent>
      <TabsContent value="fiscal">
        <FiscalView
          rate={rate.usdToVes}
          drafts={drafts.map((d) => ({
            id: d.id,
            documentType: d.documentType,
            ticketType: d.ticketType,
            homologation: d.homologation,
            controlNumber: d.controlNumber,
            invoiceNumber: d.invoiceNumber,
            customerName: d.customerName,
            customerRif: d.customerRif,
            customerCi: d.customerCi,
            channel: d.channel,
            totalUsd: d.totalUsd,
            totalVes: d.totalVes,
            ivaUsd: d.ivaUsd,
            igtfUsd: d.igtfUsd,
            ivaBreakdown: d.ivaBreakdown,
            bcvRate: d.bcvRate,
            usdRef: d.usdRef,
            createdAt: d.createdAt.toISOString(),
            check: {
              folio: d.check.folio,
              table: d.check.table ? { number: d.check.table.number } : null,
            },
          }))}
        />
      </TabsContent>
    </Tabs>
  );
}
