// CH1 — Kanal-LANDKARTE für die kind-Auflösung.
//
// Die Map fürs kind-Mapping wird ORG-WEIT gebaut: alle Standorte, aktiv UND
// inaktiv. Grund (Vorfall 02.08.): Der Kanal-Katalog wurde standortgefiltert
// geladen, die Session-Daten des neuen Standorts konnten den Katalog
// überholen — `resolveChannelKind` warf dann „unbekannter Kanal <id>" und riss
// die ganze Kassen-Route ab. Mit einer org-weiten Landkarte entfällt das
// Standort-Race strukturell; die Strenge von `resolveChannelKind` bleibt und
// trifft nur noch echte Geister-IDs (gelöscht — fremde Org ist per RLS
// unmöglich).
//
// WICHTIG: Diese Map dient NUR der kind-Auflösung. Welche Kanal-Eingabefelder
// die Kasse ANZEIGT, bleibt standortgefiltert.

export type ChannelMappingRow = { id: string; kind: string };

export function buildChannelKindMap(rows: readonly ChannelMappingRow[]): Map<string, string> {
  return new Map(rows.map((r) => [r.id, r.kind] as const));
}
