"use client";

import { useEffect, useState } from "react";

export function LiveClock() {
  const [now, setNow] = useState<Date | null>(null);
  useEffect(() => {
    setNow(new Date());
    const t = setInterval(() => setNow(new Date()), 1000);
    return () => clearInterval(t);
  }, []);
  if (!now) return <span className="tabular-nums text-muted-foreground">--:--</span>;
  return (
    <span className="tabular-nums">
      {now.toLocaleTimeString("es-VE", { hour: "2-digit", minute: "2-digit" })}
    </span>
  );
}
