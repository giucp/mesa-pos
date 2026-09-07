import { DEMO_PINS } from "@/lib/paths";

/** Demo credentials must never authorize a regular production deployment. */
export function demoAccessEnabled() {
  return process.env.MESA_ISOLATED_DEMO === "1";
}

export function demoEmailForPin(pin: unknown): string | null {
  if (!demoAccessEnabled() || typeof pin !== "string") return null;
  const value = pin.trim();
  return /^\d{4}$/.test(value) && Object.prototype.hasOwnProperty.call(DEMO_PINS, value) ? DEMO_PINS[value] : null;
}

export function allowedDemoEmail(email: unknown): email is string {
  return demoAccessEnabled() && typeof email === "string" && Object.values(DEMO_PINS).includes(email);
}
