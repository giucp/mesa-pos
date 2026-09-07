export type PaymentOpStatus = "paid" | "pending" | "unknown";

export function normalizePaymentOpId(value: unknown) {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  if (trimmed.length < 8 || trimmed.length > 128) return null;
  return /^[A-Za-z0-9._:-]+$/.test(trimmed) ? trimmed : null;
}

export function confirmedPaymentUsd(payments: { amountUsd: number; confirmed?: boolean }[]) {
  return payments.reduce((sum, payment) => sum + (payment.confirmed ? payment.amountUsd : 0), 0);
}

export function describePaymentOpStatus(status: PaymentOpStatus) {
  if (status === "paid") return "Cobrado y guardado en el servidor";
  if (status === "pending") return "Registrado pendiente de verificación";
  return "Por verificar";
}

export function classifyPaymentRow(row: { id: string; confirmed: boolean } | null | undefined): {
  status: PaymentOpStatus;
  paymentId?: string;
} {
  if (!row) return { status: "unknown" };
  return { status: row.confirmed ? "paid" : "pending", paymentId: row.id };
}
