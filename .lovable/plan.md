## Ziel

Der Standortvergleich zeigt aktuell sechs Karten in einem einzigen Grid ohne Zwischentitel. Er wird in zwei betitelte Abschnitte geteilt — analog zum bestehenden Abschnitt „Gäste & Personal".

## Umsetzung (nur Darstellung)

Datei: `src/routes/_authenticated/admin/statistik.tsx` (Zeilen ~1513–1557)

1. Das gemeinsame Grid der sechs Vergleichskarten in zwei Blöcke aufteilen, jeweils mit derselben Überschrift-Formatierung wie „Gäste & Personal" (`h3`, `mb-2 text-sm font-semibold tracking-tight text-foreground`):
   - **Umsatzvergleich**: Gesamtumsatz, Ø Tagesumsatz, Lieferumsatz
   - **Trinkgelder**: Service-Trinkgeld, Küchen-Trinkgeld, Ø Trinkgeld / Tag
2. Grid-Klassen je Block unverändert übernehmen (`grid gap-4 md:grid-cols-2 xl:grid-cols-3`), Karten-Props bleiben identisch.
3. Abschluss-Check: `tsgo` und ein Screenshot des Standortvergleichs zur Sichtprüfung der drei Abschnittstitel.

Keine Änderung an Daten, Berechnungen oder am PDF-Export.
