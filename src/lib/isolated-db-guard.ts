/** Guards so isolated demo never uses Café Ávila / mesa_runtime. */

export function isIsolatedPersistentUrl(url?: string | null) {
  if (!url) return false;
  return /mesa_isolated/i.test(url) && /isolated_fase6/i.test(url);
}

export function looksLikeOliveProductionUrl(url?: string | null) {
  if (!url) return false;
  if (isIsolatedPersistentUrl(url)) return false;
  if (/mesa_runtime/i.test(url)) return true;
  if (/scysseeqgxpoqmcmhvmh/i.test(url) && !/isolated_fase6/i.test(url)) return true;
  return false;
}

export function assertIsolatedPersistentUrl(url?: string | null, label = "DATABASE_URL") {
  if (looksLikeOliveProductionUrl(url)) {
    throw new Error(`${label} apunta a Café Ávila (olive). El demo aislado no puede usarla.`);
  }
  if (!isIsolatedPersistentUrl(url)) {
    throw new Error(
      `${label} debe ser mesa_isolated + schema isolated_fase6. No se acepta SQLite efímero ni olive.`,
    );
  }
}
