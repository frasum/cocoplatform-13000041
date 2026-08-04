# SE1-b — Einnahmen-Label, linke Abrechnungszeile, Rechen-Nachweis

## Bestandsmeldung (SHA `89e1f94` — „§137 eingeführt, §135/136 fehlen", origin/main)

**1. Button-Label:** Die Karte „Sonstige Einnahmen" nutzt dieselbe Komponente wie die Ausgaben-Karte (`src/components/cash/ExpenseForm.tsx`) — der Button-Text ist dort fest verdrahtet („Ausgabe hinzufügen", Zeile 48). Beide Karten in `SessionFieldsCard.tsx` rendern `<ExpenseForm …>` ohne Label-Prop. Der Mangel ist bestätigt.

**2. Wie Ausgaben/Vorschüsse heute im LINKEN Abrechnungsblock erscheinen** — zwei getrennte Blöcke:

- *Excel-Eingabetabelle* (unten, direkt vor dem Header „Kontrolle"), `SessionFieldsCard.tsx` ca. Z. 486–512: drei bedingte `ExcelReadonlyRow`s, jeweils nur wenn Summe ≠ 0:
  - „Vorschuss (Abzug)" — Betrag ohne Vorzeichen
  - „Ausgaben (Abzug)" — Betrag ohne Vorzeichen
  - „Sonstige Einnahmen" — Betrag ohne Vorzeichen (existiert bereits)
- *Kontrolle-Block* (`CashSummaryBlock.tsx`): eine Zeile „Ausgaben" mit **negativem** Betrag (`fmtEur(-expensesTotalCents)`), sichtbar bei Summe > 0. Für Vorschüsse und sonstige Einnahmen existiert dort **keine** Zeile.

**3. Rechen-Nachweis Tages-Bargeld — bereits korrekt, Fundstellen:**

- `src/lib/cash/session-day-input.ts` Z. 54: `sonstigeEinnahmeCents: args.otherIncomesCents.reduce(…)` — Positions-SUMME.
- `src/lib/cash/cash-ledger.ts` Z. 103 (`computeDailyCash`): `+ asInt(day.sonstigeEinnahmeCents, …)` — im selben Kern, in dem Ausgaben (`- sumExp`) und Vorschüsse (`- effectiveVorschussCents`) verrechnet werden.
- Kasse (`CashSummaryBlock.tsx` Z. 83), PDF (`pdfExport.ts` Z. 292) und Druck (`DailyPrintView.tsx` Z. 210) speisen alle `otherIncomesCents` in denselben Helper — kein Fix nötig, nur Absicherung durch Test.

## Umsetzung

**Label als Prop (kein geteilter String)**

- `ExpenseForm` bekommt eine optionale Prop `submitLabel?: string`, Default `"Ausgabe hinzufügen"`.
- Die Einnahmen-Karte übergibt `submitLabel="Einnahme hinzufügen"`; die Ausgaben-Karte bleibt unverändert.

**Linke Abrechnungsspalte — Vorzeichen erkennbar**

- Excel-Tabelle: Abzugszeilen (Vorschuss, Ausgaben) zeigen künftig einen negativen Betrag, die Einnahmezeile „Sonstige Einnahmen" einen positiven (`fmtSignedCents` aus `kasse-helpers`); Vorzeichen kommt aus der Fachlogik.
- Kontrolle-Block: analog zur bestehenden „Ausgaben"-Zeile eine bedingte Zeile „Sonstige Einnahmen" mit Plus-Betrag (grün wie andere Plus-Werte), sichtbar sobald mindestens eine Position existiert. Zusätzlich im selben Muster eine Zeile „Vorschuss" mit Minus-Betrag, damit alle drei Positionsarten gleich dargestellt sind.
- Reihenfolge: Fehlbetrag Vortag, Ausgaben (−), Vorschuss (−), Sonstige Einnahmen (+), Tages-Bargeld.

**Blockierender Test**

- Neue Datei `src/lib/cash/other-incomes-daily-cash.test.ts`:
  - Fixture-Session ohne Einnahme-Position vs. mit einer Position 30,00 € ⇒ `computeDailyCashWithTipRemainder` genau **+3000 Cent** höher.
  - Mehrere Positionen werden summiert.
  - Konsistenz Druck/PDF: derselbe `sessionToDayInput`-Aufbau wie in `pdfExport.ts` / `DailyPrintView.tsx` liefert dieselbe Zahl wie der Kassen-Pfad.

## Nicht angefasst

Ausgaben-/Vorschuss-*Logik* (nur Darstellung im Kontrolle-Block wird ergänzt), EX2-b-Export, SE1-Migration, `pap-2026/**`.

## Gates

Typecheck, Vitest (inkl. neuer Test), Build, `prettier --write` vor dem Commit. Eine Runde = ein Commit.