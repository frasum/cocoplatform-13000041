## Ziel

Die Summen-Kacheln (Umsatz, Trinkgeld, Gäste, Arbeitsstunden) nutzen aktuell einen geteilten Anteils-Balken (`ShareBar`, eine Zeile, 54 % / 46 %). Sie sollen dieselbe zweizeilige Balken-Anordnung bekommen wie „Ø Umsatz je Gast" und „Umsatz je Arbeitsstunde" — je Standort eine eigene Zeile mit Wert rechts.

## Umsetzung (nur Darstellung, keine Rechenlogik)

Datei: `src/routes/_authenticated/admin/statistik.tsx`

1. `LevelBar` um eine optionale Zusatzangabe erweitern, damit bei Summen neben dem Wert der Anteil sichtbar bleibt (z. B. rechts `11.603,68 €` und darunter/daneben `53 %`). Die bestehende Verwendung bei den Dichte-Kacheln bleibt unverändert (kein Anteil, da dort rechnerisch irreführend).
2. In `SumCompareCard` den `ShareBar`-Aufruf durch `LevelBar` ersetzen:
   - Zeile 1: Standort A, Balken skaliert am größeren der beiden Werte, Wert + Anteil.
   - Zeile 2: Standort B analog.
   - Farben bleiben `bg-chart-1` / `bg-chart-2`, Höhe/Radius wie bisher.
3. `ShareBar` entfernen, sobald keine Verwendung mehr existiert (sonst Lint-Warnung wegen ungenutzter Komponente) — vorher per Suche prüfen, ob die Komponente noch woanders eingesetzt wird.
4. Kurz-Check: `tsgo` sowie bestehende Statistik-Tests laufen lassen; Screenshot des Standortvergleichs zur Sichtprüfung.

## Technischer Hinweis

Bei Summen ist die Skalierung am Maximum identisch mit dem Anteilsverhältnis, d. h. der Informationsgehalt bleibt gleich — es ändert sich nur die Anordnung. Die PDF-Ausgabe (`statistik-pdf.ts`) ist davon nicht betroffen und bleibt unangetastet.
