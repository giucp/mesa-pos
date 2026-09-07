export default function AppLoading() {
  return (
    <div className="flex h-full items-center justify-center">
      <div className="rounded-2xl border border-dashed border-border px-8 py-10 text-center">
        <div className="text-sm font-medium">Cargando estación…</div>
        <div className="mt-1 text-xs text-muted-foreground">Un momento</div>
      </div>
    </div>
  );
}
