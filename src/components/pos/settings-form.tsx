"use client";

import { useState, useTransition } from "react";
import {
  refreshBcvAction,
  setMethodIgtfAction,
  togglePaymentMethodAction,
  updateRestaurantAction,
} from "@/actions/settings";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { sourceLabel } from "@/lib/bcv-label";
import { FiscalBanner } from "@/components/pos/fiscal-banner";
import {
  BCV_BOOKS_NOTE,
  IGTF_POLICY_NOTE,
  TIP_POLICY_NOTE,
  FISCAL_COPY,
  WITHHOLDING_NOTE,
  mediaConnectionLabel,
} from "@/lib/fiscal";

export function SettingsForm({
  restaurant,
  methods,
}: {
  restaurant: {
    name: string;
    rif: string;
    address: string | null;
    phone: string | null;
    ivaRate: number;
    igtfBancarizadoRate: number;
    igtfForexRate: number;
    tipInTaxableBase: boolean;
    bcvRate: number;
    bcvSource: string;
    bcvUpdatedAt: string;
    fiscalAdapterMf: string;
    fiscalAdapterDigital: string;
  };
  methods: {
    id: string;
    key: string;
    label: string;
    enabled: boolean;
    currency: string;
    hint: string | null;
    igtfProfile: string;
  }[];
}) {
  const [pending, start] = useTransition();
  const [msg, setMsg] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);

  return (
    <div className="mx-auto max-w-3xl space-y-8 p-4 pb-16">
      <div>
        <h1 className="text-lg font-semibold">Ajustes del local</h1>
        <p className="text-sm text-muted-foreground">
          RIF emisor, IVA 16% (8 / 31 / exento por ítem), IGTF por método, tasa BCV y propina (Regl.
          LIVA art. 39). IGTF y propina son ajustes operativos — zona gris, no dictamen.
        </p>
      </div>

      <FiscalBanner />

      {msg ? (
        <Alert>
          <AlertDescription>{msg}</AlertDescription>
        </Alert>
      ) : null}
      {err ? (
        <Alert variant="destructive">
          <AlertDescription>{err}</AlertDescription>
        </Alert>
      ) : null}

      <form
        className="space-y-4 rounded-2xl border border-border bg-card p-4"
        action={(fd) => {
          start(async () => {
            setErr(null);
            const res = await updateRestaurantAction(fd);
            if (res.error) setErr(res.error);
            else setMsg("Perfil fiscal guardado.");
          });
        }}
      >
        <div className="grid gap-3 sm:grid-cols-2">
          <Field name="name" label="Nombre comercial" defaultValue={restaurant.name} />
          <Field name="rif" label="RIF emisor" defaultValue={restaurant.rif} />
          <Field name="address" label="Dirección" defaultValue={restaurant.address ?? ""} />
          <Field name="phone" label="Teléfono" defaultValue={restaurant.phone ?? ""} />
          <Field name="ivaRate" label="IVA general % (default 16)" defaultValue={String(restaurant.ivaRate)} />
          <Field name="bcvRate" label="Tasa BCV (Bs por USD)" defaultValue={restaurant.bcvRate.toFixed(4)} />
          <Field
            name="igtfBancarizadoRate"
            label="IGTF bancarizado %"
            defaultValue={String(restaurant.igtfBancarizadoRate)}
          />
          <Field
            name="igtfForexRate"
            label="IGTF forex / no bancarizado %"
            defaultValue={String(restaurant.igtfForexRate)}
          />
        </div>
        <label className="flex items-start gap-3 text-sm">
          <input
            type="checkbox"
            name="tipInTaxableBase"
            defaultChecked={restaurant.tipInTaxableBase}
            className="mt-1"
          />
          <span>
            Incluir propina / cargo de servicio en la base imponible (apagado por defecto — Regl. LIVA
            art. 39: propina vs servicio).
          </span>
        </label>
        <p className="text-xs text-muted-foreground">{TIP_POLICY_NOTE}</p>
        <p className="text-xs text-muted-foreground">{IGTF_POLICY_NOTE}</p>
        <p className="text-xs text-muted-foreground">{BCV_BOOKS_NOTE}</p>
        <p className="text-xs text-muted-foreground">
          Fuente BCV: {sourceLabel(restaurant.bcvSource)} ·{" "}
          {new Date(restaurant.bcvUpdatedAt).toLocaleString("es-VE")}
        </p>
        <div className="flex flex-wrap gap-2">
          <Button type="submit" disabled={pending} className="pos-touch">
            Guardar
          </Button>
          <Button
            type="button"
            variant="secondary"
            disabled={pending}
            className="pos-touch"
            onClick={() =>
              start(async () => {
                const res = await refreshBcvAction();
                if (res.error) setErr(res.error);
                else setMsg(`Tasa actualizada: ${res.rate}`);
              })
            }
          >
            Consultar proveedor BCV
          </Button>
        </div>
        <Field
          name="motivo"
          label="Motivo (obligatorio si cambias IVA / IGTF)"
          defaultValue=""
        />
        <p className="text-xs text-muted-foreground">
          La tasa se consulta al proveedor configurado o se carga a mano. No hay API REST oficial del
          BCV. Se congela al abrir la cuenta y no se reescribe.
        </p>
      </form>

      <section className="space-y-3 rounded-2xl border border-border bg-card p-4">
        <h2 className="text-base font-semibold">{FISCAL_COPY.mediaTitle}</h2>
        <p className="text-sm text-muted-foreground">{FISCAL_COPY.mediaHelp}</p>
        <div className="space-y-3">
          <div className="rounded-xl border border-border bg-background/60 px-3 py-3">
            <div className="flex flex-wrap items-baseline justify-between gap-2">
              <div className="text-sm font-medium">{FISCAL_COPY.mfLabel}</div>
              <div className="text-xs text-muted-foreground">
                {mediaConnectionLabel(restaurant.fiscalAdapterMf)}
              </div>
            </div>
            <p className="mt-1 text-xs text-muted-foreground">{FISCAL_COPY.mfHelp}</p>
          </div>
          <div className="rounded-xl border border-border bg-background/60 px-3 py-3">
            <div className="flex flex-wrap items-baseline justify-between gap-2">
              <div className="text-sm font-medium">{FISCAL_COPY.digitalLabel}</div>
              <div className="text-xs text-muted-foreground">
                {mediaConnectionLabel(restaurant.fiscalAdapterDigital)}
              </div>
            </div>
            <p className="mt-1 text-xs text-muted-foreground">{FISCAL_COPY.digitalHelp}</p>
          </div>
        </div>
        <p className="text-xs text-muted-foreground">{WITHHOLDING_NOTE}</p>
      </section>

      <section className="space-y-3">
        <h2 className="text-base font-semibold">Métodos de pago e IGTF</h2>
        <div className="space-y-2">
          {methods.map((m) => (
            <div
              key={m.id}
              className="flex flex-wrap items-center justify-between gap-3 rounded-2xl border border-border bg-card px-4 py-3"
            >
              <div>
                <div className="text-sm font-medium">{m.label}</div>
                <div className="text-xs text-muted-foreground">
                  {m.currency}
                  {m.hint ? ` · ${m.hint}` : ""}
                </div>
              </div>
              <div className="flex items-center gap-3">
                <select
                  className="h-11 rounded-lg border border-border bg-background px-2 text-sm"
                  defaultValue={m.igtfProfile}
                  onChange={(e) =>
                    start(async () => {
                      await setMethodIgtfAction(m.id, e.target.value);
                    })
                  }
                >
                  <option value="BANCARIZADO">Bancarizado (usa % 0 por defecto)</option>
                  <option value="FOREX">Forex / no bancarizado (usa % 3 por defecto)</option>
                </select>
                <Switch
                  checked={m.enabled}
                  onCheckedChange={(v) =>
                    start(async () => {
                      await togglePaymentMethodAction(m.id, v);
                    })
                  }
                />
              </div>
            </div>
          ))}
        </div>
      </section>
    </div>
  );
}

function Field({
  name,
  label,
  defaultValue,
}: {
  name: string;
  label: string;
  defaultValue: string;
}) {
  return (
    <div className="space-y-1">
      <Label htmlFor={name}>{label}</Label>
      <Input id={name} name={name} defaultValue={defaultValue} className="h-11" />
    </div>
  );
}
