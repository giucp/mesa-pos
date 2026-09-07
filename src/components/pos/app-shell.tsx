"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import {
  LayoutGrid,
  CookingPot,
  UtensilsCrossed,
  Banknote,
  BarChart3,
  Settings,
  Users,
  LogOut,
  BookOpen,
  ScrollText,
  Package,
} from "lucide-react";
import { logoutAction } from "@/actions/auth";
import { cn } from "@/lib/utils";
import { can, ROLE_LABEL, type Role } from "@/lib/roles";
import { formatVes } from "@/lib/money";
import { sourceLabel } from "@/lib/bcv-label";
import { paths } from "@/lib/paths";
import { LiveClock } from "@/components/pos/clock";
import { StatusChip } from "@/components/pos/status-chip";
import { ThemeToggle } from "@/components/pos/theme-toggle";
import { OfflineSync } from "@/components/pos/offline-sync";
import { Button } from "@/components/ui/button";
import { ISOLATED_DEMO } from "@/lib/isolated-demo";

const NAV = [
  { href: paths.floor, label: "Salón", icon: LayoutGrid, action: "salon" as const },
  { href: paths.kds, label: "Cocina", icon: CookingPot, action: "kitchen" as const },
  { href: paths.menu, label: "Menú", icon: BookOpen, action: "order" as const },
  { href: paths.turno, label: "Turno", icon: Banknote, action: "checkout" as const },
  { href: paths.reportsDay, label: "Caja y reportes", icon: BarChart3, action: "reports" as const },
  { href: paths.menuAdmin, label: "Administrar menú", icon: UtensilsCrossed, action: "menu" as const },
  { href: paths.staff, label: "Equipo", icon: Users, action: "staff" as const },
  { href: paths.auditoria, label: "Auditoría", icon: ScrollText, action: "audit" as const },
  { href: paths.inventario, label: "Inventario", icon: Package, action: "menu" as const, isolated: true },
  { href: paths.settings, label: "Ajustes", icon: Settings, action: "settings" as const },
];

export function AppShell({
  children,
  user,
  restaurantName,
  rate,
  rateSource,
  rateAt,
}: {
  children: React.ReactNode;
  user: { name: string; role: Role };
  restaurantName: string;
  rate: number;
  rateSource: string;
  rateAt: string;
}) {
  const pathname = usePathname();
  const items = NAV.filter((n) => can(user.role, n.action) && (!("isolated" in n && n.isolated) || ISOLATED_DEMO));

  return (
    <div className="flex h-dvh overflow-hidden bg-background">
      <aside className="flex w-[92px] shrink-0 flex-col border-r border-sidebar-border bg-sidebar md:w-[108px]">
        <div className="flex h-16 items-center justify-center border-b border-sidebar-border px-2">
          <div className="text-center">
            <div className="text-lg font-semibold tracking-tight text-primary">Mesa</div>
            <div className="text-[10px] uppercase tracking-[0.18em] text-muted-foreground">
              POS VE
            </div>
          </div>
        </div>
        <nav className="flex flex-1 flex-col gap-1 p-2">
          {items.map((item) => {
            const active =
              pathname === item.href ||
              (item.href !== paths.menu && pathname.startsWith(item.href + "/")) ||
              (item.href === paths.menu && pathname === "/menu");
            const Icon = item.icon;
            return (
              <Link
                key={item.href}
                href={item.href}
                className={cn(
                  "flex min-h-11 flex-col items-center justify-center gap-1 rounded-xl px-1 py-2 text-center text-[11px] font-medium transition",
                  active
                    ? "bg-sidebar-primary text-sidebar-primary-foreground shadow-sm"
                    : "text-sidebar-foreground/80 hover:bg-sidebar-accent",
                )}
              >
                <Icon className="size-5" />
                {item.label}
              </Link>
            );
          })}
        </nav>
        <form action={logoutAction} className="p-2">
          <Button
            type="submit"
            variant="ghost"
            className="h-14 w-full min-h-11 flex-col gap-1 text-[11px] text-muted-foreground"
          >
            <LogOut className="size-4" />
            Salir
          </Button>
        </form>
      </aside>

      <div className="flex min-w-0 flex-1 flex-col">
        <header className="flex h-14 shrink-0 items-center justify-between gap-3 border-b border-border bg-card/70 px-3 backdrop-blur">
          <div className="min-w-0">
            <div className="flex items-center gap-2">
              <div className="truncate text-sm font-semibold">{restaurantName}</div>
              <StatusChip />
              {ISOLATED_DEMO ? (
                <span className="rounded-full bg-primary/15 px-2 py-0.5 text-[10px] font-medium text-primary">
                  Demo aislado
                </span>
              ) : null}
            </div>
            <div className="text-xs text-muted-foreground">
              {user.name} · {ROLE_LABEL[user.role]}
            </div>
          </div>
          <div className="flex items-center gap-2 text-right sm:gap-3">
            <div className="hidden sm:block">
              <div className="text-[10px] uppercase tracking-wider text-muted-foreground">
                Tasa BCV
              </div>
              <div className="text-sm font-semibold tabular-nums">
                {formatVes(Math.round(rate * 100))} / USD
              </div>
              <div className="text-[10px] text-muted-foreground">
                {sourceLabel(rateSource)} ·{" "}
                {new Date(rateAt).toLocaleString("es-VE", {
                  day: "2-digit",
                  month: "short",
                  hour: "2-digit",
                  minute: "2-digit",
                })}
              </div>
            </div>
            <ThemeToggle />
            <div className="hidden text-lg font-medium md:block">
              <LiveClock />
            </div>
          </div>
        </header>
        <OfflineSync />
        <main className="min-h-0 flex-1 overflow-auto">{children}</main>
      </div>
    </div>
  );
}
