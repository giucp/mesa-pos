export const paths = {
  home: "/floor",
  floor: "/floor",
  table: (id: string) => `/table/${id}`,
  menu: "/menu",
  menuAdmin: "/menu/admin",
  check: (id: string) => `/check/${id}`,
  cuenta: (id: string) => `/cuenta/${id}`,
  pay: (id: string) => `/pay/${id}`,
  split: (id: string) => `/split/${id}`,
  kds: "/kds",
  kdsStation: (slug: string) => `/kds/${slug}`,
  reportsDay: "/reports/day",
  turno: "/turno",
  staff: "/staff",
  auditoria: "/auditoria",
  inventario: "/inventario",
  settings: "/settings",
  fiscal: "/reports/day",
};

export const DEMO_PINS: Record<string, string> = {
  "1111": "admin@mesa.ve",
  "2222": "cajero@mesa.ve",
  "3333": "mesero@mesa.ve",
  "4444": "cocina@mesa.ve",
};

export function tableUiState(input: {
  status: string;
  checks: { status: string; lines: { status: string }[] }[];
}) {
  const check = input.checks.find((c) => ["OPEN", "SENT", "PARTIAL"].includes(c.status));
  if (!check) return "libre" as const;
  if (check.status === "SENT" || check.status === "PARTIAL") return "cuenta" as const;
  return "ocupada" as const;
}

export const TABLE_STATE_LABEL = {
  libre: "Libre",
  ocupada: "Ocupada",
  cuenta: "Cuenta",
  cerrada: "Cerrada",
};
