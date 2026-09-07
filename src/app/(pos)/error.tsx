"use client";

export default function PosError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  return (
    <div className="flex h-full flex-col items-center justify-center gap-3 p-8 text-center">
      <h1 className="text-lg font-semibold">No se pudo cargar esta pantalla</h1>
      <p className="max-w-md text-sm text-muted-foreground">{error.message}</p>
      <button
        type="button"
        onClick={reset}
        className="min-h-11 rounded-xl bg-primary px-4 py-3 text-sm font-medium text-primary-foreground"
      >
        Reintentar
      </button>
    </div>
  );
}
