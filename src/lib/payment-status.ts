export type PaymentOpStatus = "paid" | "pending" | "unknown";

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
