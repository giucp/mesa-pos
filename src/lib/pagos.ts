export const DIGITAL_TENDERS = ["PAGO_MOVIL", "TRANSFER", "ZELLE", "BIOPAGO", "ZINLI", "CASHEA"] as const;

export const PENDING_PAY_INTEGRATIONS = [
  { key: "MERCANTIL_C2P", label: "Cobro automático C2P", note: "No disponible. Usa Pago Móvil con confirmación manual." },
  { key: "MEGASOFT", label: "Pasarela bancaria", note: "No disponible en esta fase." },
  { key: "BIOPAGO_SDK", label: "Biopago automático", note: "No disponible. Confirma el punto a mano." },
  { key: "CASHEA_SDK", label: "Cashea", note: "No disponible en esta fase." },
] as const;
