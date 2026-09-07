"use client";

import { useState, useTransition } from "react";
import { demoLoginAction, loginAction, pinLoginAction } from "@/actions/auth";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { ROLE_LABEL, type Role } from "@/lib/roles";
import { Delete } from "lucide-react";

const DEMOS: { email: string; role: Role; name: string; pin: string }[] = [
  { email: "admin@mesa.ve", role: "ADMIN", name: "Ana Rivas", pin: "1111" },
  { email: "cajero@mesa.ve", role: "CAJERO", name: "Carlos Méndez", pin: "2222" },
  { email: "mesero@mesa.ve", role: "MESERO", name: "María Castillo", pin: "3333" },
  { email: "cocina@mesa.ve", role: "COCINA", name: "José Altuve", pin: "4444" },
];

export function LoginForm({ next: returnTo, demoEnabled = false }: { next?: string | null; demoEnabled?: boolean }) {
  const [error, setError] = useState<string | null>(null);
  const [pending, start] = useTransition();
  const [pin, setPin] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");

  function press(d: string) {
    const digits = (pin + d).slice(0, 4);
    setPin(digits);
    if (digits.length === 4) {
      start(async () => {
        setError(null);
        const res = await pinLoginAction(digits, returnTo);
        if (res?.error) {
          setError(res.error);
          setPin("");
        }
      });
    }
  }

  return (
    <div className="space-y-6">
      {demoEnabled ? <div>
        <Label>PIN de demostración</Label>
        <div className="mt-2 flex justify-center gap-2">
          {[0, 1, 2, 3].map((i) => (
            <div
              key={i}
              className="flex size-11 items-center justify-center rounded-xl border border-border bg-background text-lg font-semibold"
            >
              {pin[i] ? "•" : ""}
            </div>
          ))}
        </div>
        <div className="mt-3 grid grid-cols-3 gap-2">
          {["1", "2", "3", "4", "5", "6", "7", "8", "9", "", "0", "del"].map((k) =>
            k === "" ? (
              <div key="sp" />
            ) : k === "del" ? (
              <Button
                key="del"
                type="button"
                variant="secondary"
                className="min-h-14"
                onClick={() => setPin((p) => p.slice(0, -1))}
              >
                <Delete className="size-5" />
              </Button>
            ) : (
              <Button
                key={k}
                type="button"
                variant="secondary"
                className="min-h-14 text-xl"
                disabled={pending}
                onClick={() => press(k)}
              >
                {k}
              </Button>
            ),
          )}
        </div>
      </div> : null}

      <form
        className="space-y-4"
        onSubmit={(e) => {
          e.preventDefault();
          const fd = new FormData();
          fd.set("email", email);
          fd.set("password", password);
          if (returnTo) fd.set("next", returnTo);
          start(async () => {
            setError(null);
            const res = await loginAction(fd);
            if (res?.error) setError(res.error);
          });
        }}
      >
        <div className="space-y-2">
          <Label htmlFor="email">Correo</Label>
          <Input
            id="email"
            name="email"
            type="email"
            autoComplete="username"
            placeholder="mesero@mesa.ve"
            className="h-12 bg-background/60"
            required
            value={email}
            onChange={(e) => setEmail(e.target.value)}
          />
        </div>
        <div className="space-y-2">
          <Label htmlFor="password">Clave</Label>
          <Input
            id="password"
            name="password"
            type="password"
            autoComplete="current-password"
            placeholder="••••••••"
            className="h-12 bg-background/60"
            required
            value={password}
            onChange={(e) => setPassword(e.target.value)}
          />
        </div>
        {error ? (
          <Alert variant="destructive">
            <AlertDescription>{error}</AlertDescription>
          </Alert>
        ) : null}
        <Button type="submit" className="h-12 w-full text-base" disabled={pending}>
          {pending ? "Entrando…" : "Entrar con clave"}
        </Button>
      </form>

      {demoEnabled ? <div>
        <p className="mb-3 text-xs font-medium uppercase tracking-wider text-muted-foreground">
          Acceso demo — un toque
        </p>
        <div className="grid grid-cols-2 gap-2">
          {DEMOS.map((d) => (
            <button
              key={d.email}
              type="button"
              disabled={pending}
              onClick={() => {
                start(async () => {
                  setError(null);
                  const res = await demoLoginAction(d.email, returnTo);
                  if (res?.error) setError(res.error);
                });
              }}
              className="min-h-14 rounded-xl border border-border bg-secondary/60 px-3 py-3 text-left transition hover:border-primary/50 hover:bg-secondary"
            >
              <div className="text-sm font-semibold">{ROLE_LABEL[d.role]}</div>
              <div className="text-xs text-muted-foreground">
                {d.name} · PIN {d.pin}
              </div>
            </button>
          ))}
        </div>
        <p className="mt-3 text-center text-xs text-muted-foreground">
          Clave de todos: <span className="font-mono text-foreground">mesa123</span>
        </p>
      </div> : null}
    </div>
  );
}
