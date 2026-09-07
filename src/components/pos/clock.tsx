"use client";

import { useEffect, useState } from "react";

export function LiveClock() {
  const [now, setNow] = useState<Date | null>(null);
  useEffect(() => {
    const tick = () => setNow(new Date());
    const first = setTimeout(tick, 0);
    const interval = setInterval(tick, 1000);
    return () => {
      clearTimeout(first);
      clearInterval(interval);
    };
  }, []);
  if (!now) return <span className="tabular-nums text-muted-foreground">--:--</span>;
  return (
    <span className="tabular-nums">
      {now.toLocaleTimeString("es-VE", { hour: "2-digit", minute: "2-digit" })}
    </span>
  );
}
