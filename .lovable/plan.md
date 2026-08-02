## Bestandsmeldung

Basis `origin/main`, HEAD `359ec6df2` („style: prettier autofix [bot]", nach STAT3f). Reine Präsentationsrunde in `src/lib/statistics/statistik-pdf.ts` + `statistik-pdf-charts.ts`.

### Befund zu Punkt 1 (Ursache, nicht still gefixt)

Skala und Ticks stammen aus **zwei verschiedenen Obergrenzen** — und zwar in allen Chart-Typen:
- Die Geometrien skalieren mit `(value / dataMax)` bzw. `(value - baseline) / (dataMax - baseline)`, also gegen das **rohe Datenmaximum**.
- Die Achsenwerte kommen aus `ticksFor(dataMax, …)`, das `niceTicks(baseline, dataMax)` bildet und danach **jeden Rasterwert > dataMax wegfiltert**.

Ergebnis: der oberste gezeichnete Tick liegt unter dem Datenmaximum, Balken/Punkte ragen darüber hinaus und wirken abgeschnitten (5-Jahres-Grafik 1.171 über 1.000er-Tick, Tagesumsatz über 10-T€-Tick, Dezember der 13-Monats-Linie über 180er-Tick). Der Filter war für die geschnittene Linien-Achse gedacht, ist aber für das obere Ende überall falsch.

## Änderungen

### 1. Skalen-Abschluss für ALLE Chart-Typen
In `statistik-pdf-charts.ts` ersetzt eine gemeinsame Achsenfunktion `axisFor(dataMax, area, tickCount, baseline)` das heutige `ticksFor`:
- Obergrenze der Skala = `niceTicks(baseline, dataMax, tickCount).top` — per Konstruktion ≥ Datenmaximum (1.171 ⇒ 1.250 im 250er-Raster).
- Alle Rasterwerte werden gezeichnet, keine Filterung des oberen Endes mehr.
- Die untere Kappung (`baseline`) bleibt exakt wie heute: 0 bei allen Balken-Charts, `niceTicks`-Baseline nur bei `lineChartGeometry` mit `baseline: "nice"`.

Angewendet auf `barChartGeometry`, `stackedBarChartGeometry`, `groupedBarChartGeometry` und `lineChartGeometry`. Das zurückgegebene Feld `max` bedeutet künftig „Skalen-Obergrenze" (Doku-Kommentar entsprechend).

Blockierende Tests je Chart-Typ in `statistik-pdf-charts.test.ts`: „oberster Tick ≥ Datenmaximum" plus Nachweis, dass kein Balken/Punkt die Fläche nach oben verlässt (`y >= area.y`); für die 5-Jahres-Grafik konkret max 1.171 ⇒ oberster Tick 1.250. Bestehende Tests, die die alte „Maximum füllt die Fläche exakt"-Annahme prüfen (u. a. `[1.400, 900]`, `[500, 500]`, Linien-Baseline-Fall), werden auf die neue Regel nachgezogen.

### 2. Wertelabels ohne Einheit
Neue reine Formathilfe `formatTsdPlain(cents)` (Tausenderpunkt, kein „T€"). Nur die Balkenlabels der 5-Jahres-Grafik nutzen sie; Achsenlabels behalten „T€". Kurzer Formattest.

### 3. Neue Trinkgeld-Zeile
Direkt unter der Standort-Tabelle, im Stil der Takeaway-Kopfzeile (fette Blocküberschrift „Trinkgeld" + eine Wertezeile):

```text
Trinkgeld   Service 12.480 € (4,2 % vom Haus) · Küche 3.120 € (1,1 %) · Gesamt 15.600 € (5,3 %)
```

- Beträge über `fmtEurRounded` (STAT3d), Quoten über den bestehenden Prozent-Formatierer (eine Nachkommastelle).
- Quoten ausschließlich über die bestehende `tipRatePct(tip, houseCents)`. `houseCents ≤ 0` ⇒ `null` ⇒ „—" (Variante B).
- Werte aus dem vorhandenen `data.tips` + `data.revenue.houseCents`; Scope-Logik liegt schon im Aufrufer. Keine Standort-Aufschlüsselung.

Blockierender Selbsttest: Die Gesamt-Quote der Zeile ist zeichengleich mit der TG-Quote-Zelle der Gesamt-Zeile der Standort-Tabelle (gleiche Fixture, beide aus dem gezeichneten PDF gelesen).

### 4. Blockreihenfolge
KPI-Kacheln → Standort-Vergleich → Trinkgeld-Zeile → Take-Away-Kanäle → Tagesumsatz → 13-Monats-Verlauf → Jan–&lt;M&gt; kumuliert (5 Jahre) → Fußnoten. Die 5-Jahres-Grafik wandert von zwischen den Tabellen ans Ende der Grafik-Sequenz. Inhalte unverändert; die gemeinsame Farb-/Legendenzuordnung (`registerSeries`, `colorOf`, `drawLegend`) wird vor den ersten Block gezogen, damit Standortfarben über alle drei Grafiken identisch bleiben.

### 5. Einheitliche Blockabstände
Eine Konstante `BLOCK_GAP` (Blockende → nächste Überschrift) statt der heutigen Streuwerte (12 / 10 / 18 / 20), überall verwendet. Innenabstände (Überschrift → Tabelle/Chart) bleiben.

## Nicht angefasst
Rechen- und Datenpfade, `tipRatePct` selbst, STAT3d-Rundung, STAT3e-Farben, Stapel-Logik, Kanaltabelle, KPI-Kacheln, Fußnoten-Inhalte, `monatsbericht-pdf.ts`, Bildschirm-Ansichten, `pap-2026/**`.

## Testanpassungen
`statistik-pdf.test.ts` und `stat1-e2e.test.ts` an neue Reihenfolge und die Trinkgeld-Zeile anpassen, ohne bestehende Wertprüfungen aufzuweichen.

## Gates
`tsc --noEmit`, `eslint . --max-warnings=0`, `prettier --check .` (nach `prettier --write`), `vitest run` — alle grün, eine Runde = ein Commit. Visuelle QA am gerenderten PDF beim Bauherrn.
