## Befund

Der Zeit-Eintrag von **DEAU** am 18.07. wurde in der Datenbank korrekt geändert: `started_at` steht auf 09:00 UTC statt vorher 13:00 UTC (+4 h), `updated_at` = 2026-07-26. Die Zusammenfassung zeigt trotzdem den alten Wert, bis die Seite hart neu geladen wird.

## Ursache

In `src/routes/_authenticated/admin/zeit-uebersicht.tsx` invalidieren die Wochenplan-Mutationen (`setShiftMut`, `createShiftMut`, `deleteEntryMut`) über `invalidateWeekly()` nur den React-Query-Cache-Schlüssel **`["weekly-entries"]`**.

Die Tabs **Zusammenfassung** und **Buchhaltung** hängen aber an einem anderen Server-Fn (`getTimeOverview` / `getTimeOverviewBatch`) mit den Query-Keys **`["time-overview", …]`**. Die werden nach einer Wochenplan-Änderung nirgends invalidiert, also bleibt der alte, gecachte Wert stehen. Genau dieses Muster ist in `BatchTimesCard.tsx` schon korrekt umgesetzt — dort werden beide Keys invalidiert.

Kein SFN-Aggregat, kein PostgREST-1000-Zeilen-Kappen (Zyklus hat nur 612 Zeilen) — reines Cache-Konsistenz-Problem.

## Fix (nur Frontend, ein Bauplan-Schritt)

`invalidateWeekly()` in `zeit-uebersicht.tsx` erweitern, sodass alle Sichten, die auf denselben `time_entries`-Rohdaten hängen, mit-invalidiert werden. Danach ziehen Zusammenfassung, Buchhaltung und die SFN-abhängigen Tabs (Brutto/Netto) sofort nach einer Zeitkorrektur im Wochenplan.

```ts
function invalidateWeekly() {
  void qc.invalidateQueries({ queryKey: ["weekly-entries"] });
  void qc.invalidateQueries({ queryKey: ["time-overview"] });
  void qc.invalidateQueries({ queryKey: ["time-sfn"] });         // falls Key so heißt
  void qc.invalidateQueries({ queryKey: ["payroll-notes"] });     // Abwesenheits-Notizen hängen an Einträgen
}
```

Vor dem Umbau die tatsächlichen Query-Keys für Brutto/Netto/Provision (SFN) und Payroll-Notes in derselben Datei kurz verifizieren und nur die real existierenden Keys aufnehmen — Ehrlichkeitsregel: kein Key auf Verdacht.

## Was NICHT dazugehört

- Keine Server-Fn-Änderung, kein SQL, keine Migration.
- Kein Umbau der Struktur (etwa gemeinsamer Root-Key `["time"]`) — das wäre ein separater Cleanup-Schritt.
- DEAU-Daten selbst nicht anfassen; die DB ist bereits korrekt.

## Verifikation

1. `tsgo --noEmit` + Vitest laufen lassen.
2. Manuell: im Wochenplan eine Zeit ändern → in Zusammenfassung/Buchhaltung/Brutto ohne Reload sofort neuer Wert sichtbar.
