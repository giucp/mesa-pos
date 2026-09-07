import Link from "next/link";

export default function NotFound() {
  return (
    <div className="flex min-h-dvh flex-col items-center justify-center gap-3">
      <h1 className="text-xl font-semibold">No encontrado</h1>
      <Link href="/app" className="text-sm text-primary underline">
        Volver al POS
      </Link>
    </div>
  );
}
