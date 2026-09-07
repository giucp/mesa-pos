export function auditDetails(input: {
  entity?: string;
  entityId?: string;
  folio?: string | null;
  itemName?: string | null;
  from?: unknown;
  to?: unknown;
  extra?: Record<string, unknown>;
}) {
  return JSON.stringify({
    entity: input.entity,
    entityId: input.entityId,
    folio: input.folio ?? null,
    itemName: input.itemName ?? null,
    from: input.from ?? null,
    to: input.to ?? null,
    ...input.extra,
  });
}
