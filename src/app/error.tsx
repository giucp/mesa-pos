"use client";

export default function ErrorPage({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  return (
    <div className="flex min-h-dvh flex-col items-center justify-center gap-3 px-4 text-center">
      <h1 className="text-xl font-semibold">Algo falló</h1>
      <p className="max-w-md text-sm text-muted-foreground">
        {error.message || "Error inesperado. Revisa la base de datos o recarga."}
      </p>
      <button
        type="button"
        onClick={reset}
        className="rounded-xl bg-primary px-4 py-3 text-sm font-medium text-primary-foreground"
      >
        Reintentar
      </button>
    </div>
  );
}
