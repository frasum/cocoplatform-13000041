// DB1 — Diagnose-Helfer für DB-Integrationstests.
//
// Grund: In Test-Setups wurde regelmäßig `const { data } = await …` benutzt
// und das Ergebnis mit `data!.id` angefasst. Schlägt die Abfrage fehl, ist
// `data` null und der Test stirbt mit „Cannot read properties of null" —
// die tatsächliche PostgREST-Meldung (Constraint, Schema-Cache, RLS) ist zu
// diesem Zeitpunkt bereits verworfen. Dieser Helfer prüft `error`, hängt
// Code/Details an und wirft mit einem sprechenden Label.

export type PostgrestLike<T> = {
  data: T | null;
  error: {
    message: string;
    code?: string;
    details?: string | null;
    hint?: string | null;
  } | null;
};

export function expectData<T>(res: PostgrestLike<T>, label: string): T {
  if (res.error) {
    const parts = [res.error.message];
    if (res.error.code) parts.push(`code=${res.error.code}`);
    if (res.error.details) parts.push(`details=${res.error.details}`);
    if (res.error.hint) parts.push(`hint=${res.error.hint}`);
    throw new Error(`[db-test] ${label} fehlgeschlagen: ${parts.join(" · ")}`);
  }
  if (res.data === null || res.data === undefined) {
    throw new Error(`[db-test] ${label} lieferte keine Zeile (data=null, error=null)`);
  }
  return res.data;
}