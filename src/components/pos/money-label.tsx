import { formatUsd, formatVes, usdToVesCents } from "@/lib/money";
import { cn } from "@/lib/utils";

export function DualMoney({
  usdCents,
  rate,
  size = "md",
  align = "end",
}: {
  usdCents: number;
  rate: number;
  size?: "sm" | "md" | "lg";
  align?: "start" | "end";
}) {
  return (
    <div
      className={cn(
        "flex flex-col leading-tight",
        align === "end" ? "items-end text-right" : "items-start text-left",
      )}
    >
      <span
        className={cn(
          "font-semibold tabular-nums",
          size === "sm" && "text-sm",
          size === "md" && "text-base",
          size === "lg" && "text-2xl tracking-tight",
        )}
      >
        {formatUsd(usdCents)}
      </span>
      <span
        className={cn(
          "text-muted-foreground tabular-nums",
          size === "sm" && "text-[11px]",
          size === "md" && "text-xs",
          size === "lg" && "text-sm",
        )}
      >
        {formatVes(usdToVesCents(usdCents, rate))}
      </span>
    </div>
  );
}
