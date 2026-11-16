/**
 * JSON with every object's keys sorted, through arrays and nested objects, so two equal values
 * always print the same. Use it to compare a value read back from Postgres jsonb (which keeps keys
 * in its own order) with one built in code (DEF-480, DEF-481: `rebuild-not-idempotent`).
 */
export function stableJson(v: unknown): string {
  if (Array.isArray(v)) return `[${v.map(stableJson).join(',')}]`;
  if (v && typeof v === 'object') {
    return `{${Object.keys(v as object).sort().map((k) => `${JSON.stringify(k)}:${stableJson((v as Record<string, unknown>)[k])}`).join(',')}}`;
  }
  return JSON.stringify(v ?? null);
}
