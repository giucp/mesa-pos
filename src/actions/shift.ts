"use server";

import { prisma } from "@/lib/db";
import { allowAction } from "@/lib/auth-guard";
import { closeShiftOp, openShiftOp, recordCashMoveOp, rewriteClosedShiftOp } from "@/lib/ops";
import { revalidatePos } from "@/lib/revalidate";

export async function openShiftAction(input: { openingUsd: number; openingVes: number }) {
  const auth = await allowAction("checkout");
  if (!auth.ok) return { error: auth.error };
  const res = await openShiftOp(prisma, auth.user, input);
  if (!res.ok) return { error: res.error };
  revalidatePos();
  return { ok: true as const, shiftId: res.shiftId };
}

export async function recordCashMoveAction(input: {
  type: "IN" | "OUT";
  currency: "USD" | "VES";
  amountCents: number;
  concept: string;
  reason: string;
}) {
  const auth = await allowAction("checkout");
  if (!auth.ok) return { error: auth.error };
  const res = await recordCashMoveOp(prisma, auth.user, input);
  if (!res.ok) return { error: res.error };
  revalidatePos();
  return { ok: true as const };
}

export async function recordShiftCorrectionAction(input: {
  shiftId: string;
  currency: "USD" | "VES";
  amountCents: number;
  concept: string;
  reason: string;
}) {
  const auth = await allowAction("adjust");
  if (!auth.ok) return { error: auth.error };
  const res = await recordCashMoveOp(prisma, auth.user, {
    type: "CORRECTION",
    shiftId: input.shiftId,
    currency: input.currency,
    amountCents: input.amountCents,
    concept: input.concept,
    reason: input.reason,
  });
  if (!res.ok) return { error: res.error };
  revalidatePos();
  return { ok: true as const };
}

export async function closeShiftAction(input: {
  countedUsd: number;
  countedVes: number;
  reason?: string;
  transferToNext?: boolean;
}) {
  const auth = await allowAction("checkout");
  if (!auth.ok) return { error: auth.error };
  const res = await closeShiftOp(prisma, auth.user, input);
  if (!res.ok) {
    return {
      error: res.error,
      openChecks: "openChecks" in res ? res.openChecks : undefined,
      pending: "pending" in res ? res.pending : undefined,
    };
  }
  revalidatePos();
  return { ok: true as const, shiftId: res.shiftId, summary: res.summary };
}

export async function rewriteClosedShiftAction(input: {
  shiftId: string;
  countedUsd?: number;
  countedVes?: number;
  summaryJson?: string;
}) {
  const auth = await allowAction("checkout");
  if (!auth.ok) return { error: auth.error };
  const res = await rewriteClosedShiftOp(prisma, auth.user, input);
  if (!res.ok) return { error: res.error };
  return { ok: true as const };
}
