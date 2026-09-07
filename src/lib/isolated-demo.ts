export const ISOLATED_DEMO = process.env.MESA_ISOLATED_DEMO === "1";

export const FASE2_FOLIOS = {
  A: "P2-A-USD",
  B: "P2-B-VES",
  C: "P2-C-MIX",
} as const;

export const FASE2_PENDING_REF = "REF-NO-CONFIRM";

/** Isolated Fase 3 audit fixtures. Not P2 sales; never seeded on production. */
export const FASE3_AUDIT = {
  confirmFolio: "P3-AUD-CONF",
  courtesyFolio: "P3-AUD-CORT",
  confirmReason: "Prueba aislada Fase 3 — confirmación de Pago Móvil",
  courtesyReason: "Prueba aislada Fase 3 — cortesía de demostración",
  pendingRef: "P3-AUD-REF",
} as const;

export const FASE4_SHIFT = {
  folio: "P4-SHIFT-SALE",
  inConcept: "Fondo extra de demostración",
  outConcept: "Cambio a banco de demostración",
  closeReason: "Prueba aislada Fase 4 — cierre con faltante",
} as const;

export const FASE5_SYNC = {
  folio: "P5-SYNC-ORD",
  payOp: "p5-lost-response-op",
} as const;

/** Isolated Fase 6 finished-goods stock. Never seeded on olive. */
export const FASE6_STOCK = {
  itemName: "Cachapa con Queso",
  unit: "un",
  openingQty: 8,
  alertMin: 2,
  persistMotivo: "Entrada persistente Giucp — verifica recarga",
  persistOpId: "p6-giucp-persist-entrada",
  persistQty: 2,
  entradaMotivo: "Entrada persistente Giucp — verifica recarga",
  mermaMotivo: "Merma de prueba Fase 6",
} as const;
