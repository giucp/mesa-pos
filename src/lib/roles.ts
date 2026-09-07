export const ROLES = ["ADMIN", "CAJERO", "MESERO", "COCINA"] as const;
export type Role = (typeof ROLES)[number];

export type SessionUser = {
  id: string;
  email: string;
  name: string;
  role: Role;
};

export const ROLE_LABEL: Record<Role, string> = {
  ADMIN: "Administración",
  CAJERO: "Caja",
  MESERO: "Salón",
  COCINA: "Cocina",
};

export function can(role: Role, action: Action) {
  return ACTIONS[action].includes(role);
}

export type Action =
  | "salon"
  | "order"
  | "kitchen"
  | "checkout"
  | "reports"
  | "menu"
  | "settings"
  | "void"
  | "adjust"
  | "fiscal"
  | "staff"
  | "audit";

const ACTIONS: Record<Action, Role[]> = {
  salon: ["ADMIN", "CAJERO", "MESERO"],
  order: ["ADMIN", "CAJERO", "MESERO"],
  kitchen: ["ADMIN", "COCINA"],
  checkout: ["ADMIN", "CAJERO"],
  reports: ["ADMIN", "CAJERO"],
  menu: ["ADMIN"],
  settings: ["ADMIN"],
  void: ["ADMIN"],
  adjust: ["ADMIN"],
  fiscal: ["ADMIN", "CAJERO"],
  staff: ["ADMIN"],
  audit: ["ADMIN"],
};

export function homePath(role: Role) {
  if (role === "COCINA") return "/kds";
  if (role === "CAJERO") return "/floor";
  return "/floor";
}
