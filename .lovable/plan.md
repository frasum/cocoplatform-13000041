## Ziel

Jede KPI-Kachel in der Statistik zeigt unter der Trendzeile als Untertitel, gegen welchen Zeitraum verglichen wird — z. B. `vs. 01.–18.06.2026`. Damit ist ohne Nachdenken erkennbar, ob es der Vormonat, ein geklemmter Teil-Vormonat oder die vorangehende freie Spanne ist.

## Verhalten

- Untertitel erscheint nur, wenn tatsächlich ein Vergleich vorliegt (Vorperiode geladen und Trend vorhanden). Ohne Vorperiode: kein Untertitel, kein Platzhaltertext.
- Formatierung des Zeitraums:
  - gleicher Monat: `vs. 01.–18.06.2026`
  - über Monatsgrenze: `vs. 29.06.–09.07.2026`
  - ein einzelner Tag: `vs. 18.06.2026`
- Ist der laufende Monat unvollständig und der Vormonat deshalb auf denselben Tagesausschnitt geklemmt, erscheint zusätzlich der Hinweis `(gleicher Tagesausschnitt)`, damit der verkürzte Vormonat nicht wie ein Fehler wirkt.
- Untertitel dezent: kleiner als die Trendzeile, gedämpfte Farbe, keine zusätzliche Kachelhöhe außer einer Textzeile.
- Gilt für alle drei Bereiche mit Trendkacheln: Umsatz (Gesamt/Haus/Takeaway), Trinkgeld (Gesamt/Service/Küche), Personal (Stunden/Kosten).

## Technische Umsetzung

1. **Serverseitig Vergleichsfenster mitliefern.** In `src/lib/statistics/revenue-stats.functions.ts`, `tip-stats.functions.ts` und `personnel-stats.functions.ts` das bereits berechnete `previous`-Fenster (nach der U5a-Klemmung) zusätzlich als `previousRange: { startDate, endDate } | null` zurückgeben. Keine Änderung an der Berechnung, kein zusätzlicher Query — nur das schon vorhandene Fenster wird durchgereicht. `previousRange` ist `null`, wenn keine Vorperiode geladen wurde.
2. **Reine Formatierfunktion.** Neue Funktion `formatComparisonRange(range, opts)` in `src/lib/statistics/period-window.ts` (oder einem kleinen Nachbarmodul), die aus Start/Ende den kompakten deutschen Text erzeugt. Rein, testbar, ohne UI-Bezug.
3. **UI.** In `src/routes/_authenticated/admin/statistik.tsx` erhält `KpiCard` eine optionale `comparisonLabel`-Prop, die unter `TrendLine`/`TrendLineHours` gerendert wird. Die drei Sections (Umsatz, Trinkgeld, Personal) übergeben den aus `previousRange` + `coverage.isPartial` gebauten Text.
4. **Tests.** Unit-Tests für `formatComparisonRange` (gleicher Monat, Monatsgrenze, Einzeltag, Jahreswechsel) in einer Test-Datei neben `period-window.test.ts`.

Nicht Teil dieses Schritts: Statistik-PDF, Standortvergleich-Karten, sonstige Kacheln ohne Trend.
