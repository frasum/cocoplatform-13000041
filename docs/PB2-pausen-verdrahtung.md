# PB2 — Pausen-Einstellung verdrahten: ein Vergütungsstunden-Begriff für Anzeige, Export und Lohn

Zielrepo: COCO (blank-slate-react)
Migration: KEINE (Spalte `organization_settings.pausen_bezahlt` existiert seit PB1).
Datenbank: keine.
Vorgänger: PB1 (Einstellung existiert, nachweislich ohne Leser). Dieser Auftrag macht sie wirksam.
Lohnbüro-Klärung liegt vor (27.07.): SFN-Zuschläge werden IMMER auf die tatsächliche Arbeitszeit ohne Pause gerechnet — unabhängig davon, ob Pausen vergütet werden.
Aktueller Einstellungswert: `true` (Pausen bezahlt).

## Klarstellungen aus dem §104-Halt (27.07., verbindlich)

Diese Datei ist die verbindliche PB2-Spec; sie liegt als `docs/PB2-pausen-verdrahtung.md` im Repo. Referenzierte Aufträge liefert grundsätzlich der Bauherr — sie liegen nicht von selbst im Repo.

Die Spalte ist `boolean NOT NULL DEFAULT TRUE` (PB1-Migration). Es gibt keinen Null-Fall und der Default ist `true`, nicht `false`. Falls ein Info-Text in `ArbeitszeitSection.tsx` etwas anderes suggeriert: Text in dieser Runde mitkorrigieren und im Bericht nennen — nicht die Migration anfassen.

`applyBreakProration` ist reguläres Lohn-Modul (älter als die PB-Serie), keine „PB1-Logik". Es bleibt unverändert und liefert die SFN-Töpfe unter BEIDEN Schalterstellungen.

## Zielbild

Ein einziger Stundenbegriff, überall gleich:

| Größe | Regel |
| --- | --- |
| Vergütungsstunden | `pausen_bezahlt = true` → brutto (`ended − started`); `false` → netto (`− break_minutes`) |
| SFN-Töpfe (Abend/Nacht/Tiefnacht/SO/Feiertag) | immer netto via `applyBreakProration` — von der Einstellung unberührt |

Damit verschwindet die heutige Drift: Buchhaltungs-Tab/Wochenplan/Buchhaltungs-Export rechnen brutto, Lohn-Engine/Selbstansicht/Statistik netto. Nach PB2 zeigen alle dieselben Vergütungsstunden, und die SFN-Zerlegung bleibt überall die heutige Netto-Logik.

## Umsetzung

### 1. Zentrale Regel als reines Modul

Neu `src/lib/time/paid-hours.ts`:

```ts
export function paidHours(
  grossHours: number,
  breakMinutes: number,
  pausenBezahlt: boolean,
): number {
  return pausenBezahlt ? grossHours : Math.max(0, grossHours - breakMinutes / 60);
}
```

Eine Regel, eine Implementierung — jede der folgenden Stellen ruft diese Funktion; keine Inline-Kopien.

### 2. `computeShiftHours` (Buchhaltungs-Pfad)

Signatur erweitert um `breakMinutes: number` und `pausenBezahlt: boolean`. `totalHours` wird `paidHours(...)`; die SFN-Topf-Felder der Rückgabe laufen zusätzlich durch `applyBreakProration` (Import aus `lohn/time-entry-sfn.ts` — wiederverwenden, nicht nachbauen), unabhängig vom Schalter. Alle Aufrufer (`zeit-uebersicht.tsx` ×2, LG2-Aggregation in `zeit-uebersicht-core.ts`) reichen `break_minutes` und den Org-Einstellungswert durch; der Wert wird einmal pro Request geladen (bestehender `getOrgSettings`-Pfad), nicht je Eintrag.

### 3. Lohn-Engine

In `lohn-period.functions.ts` / `compute-staff-sfn.ts`: Die Grundlohn-Stundenbasis wird `paidHours(...)` (heute: netto via `applyBreakProration` auch für den Grundlohn). Die SFN-Geld-Berechnung bleibt unverändert netto — dort ändert sich nichts. Konsequenz bei `pausen_bezahlt = true`: Grundlohn auf Brutto-Stunden, Zuschläge auf Netto-Zerlegung. Genau das ist die Lohnbüro-Auskunft.

### 4. Buchhaltungs-Export

`buchhaltung-export.ts`: Stunden-Spalten (inkl. LG2-Spalten `stunden_gl/service/kueche`) auf `paidHours`-Basis — automatisch konsistent, wenn Punkt 2 sauber ist; explizit im Test abgesichert.

### 5. Bestätigungsdialog-Vorschau (aus PB1 vertagt)

Der PB1-Dialog beim Umschalten zeigt jetzt die konkrete Wirkung: „In der laufenden Periode ändern sich die Vergütungsstunden um Σ ⟨X⟩ h über ⟨N⟩ Mitarbeiter." Berechnung = Summe `break_minutes` der geschlossenen Einträge der laufenden Periode. Reine Server-Function, lesend.

## Nicht anfassen

`applyBreakProration` selbst, `berechneSfnGeld`, `pap-2026/**`, Golden-Master-Fixtures.

`my-period-hours.ts` und `personnel-stats.functions.ts` rechnen heute hart netto: auch diese auf `paidHours` umstellen (Selbstansicht und Personalquote sollen dieselben Vergütungsstunden zeigen wie der Lohn) — aber die dortige SFN-freie Struktur nicht verändern.

PB1-UI (Schalter/Audit) bis auf die Dialog-Vorschau.

`staff_compensation_rates` und alles aus LG3a (LG3b ist der Folgeauftrag).

## Erfolgs-Gate

`prettier --write` (bestätigen) + `eslint --fix`; `tsc 0 · eslint 0/0 · prettier clean`.

`npx vitest run` grün; Ausgang 1910 + neue Tests (Vorzustand nur gemessen behaupten, Anker `32f73b21` oder neuer).

Blockierende Tests:

- `paidHours`: beide Schalterstellungen, 0-Kappung.
- Schalter-Invarianz der SFN-Töpfe: identische Topf-Werte für `true` und `false` bei gleichem Eintrag.
- Konsistenz: für einen Fixture-Mitarbeiter liefern Buchhaltungs-Aggregation, Export-Zeile und Lohn-Grundlohnstunden dieselbe Zahl (beide Schalterstellungen).
- Bestandsverhalten: mit `break_minutes = 0` ist jede Zahl exakt wie vor PB2 (Charakterisierung — deckt alle Alt-Daten ab).

Meldepflicht §104: Wenn eine Stelle gefunden wird, die Stunden bildet und hier nicht aufgeführt ist (Telegram-Report, Frag-COCO, TRMNL o. ä.): melden und listen, nicht still mit umstellen.

## Klicktest (Bauherr)

1. LAM, laufende Periode: Buchhaltung zeigt Brutto-Stunden (Schalter steht auf „bezahlt"), Lohn-Tab-Grundlohn nutzt dieselbe Zahl, SFN-Beträge unverändert zur Vorwoche.
2. Schalter testweise auf „unbezahlt" → Dialog zeigt Σ-Stunden-Delta → bestätigen → Zahlen sinken um die Pausensumme, SFN-Beträge bleiben gleich → zurückschalten.
3. Export vor/nach PB2 bei einem Alt-Monat (Pause = 0 überall): byte-identisch.

## Freigabe-Auflagen (27.07.2026, aus Plan-Review)

1. Pfad-Korrektur: Personalquote liegt unter `src/lib/statistics/personnel-stats.functions.ts` (nicht `src/lib/personnel-stats/…`).
2. Info-Text in `ArbeitszeitSection.tsx` wird neutralisiert (nicht nur geprüft). Beide Schalter-Stellungen sind legitim; die Sektion beschreibt Wirkungen, empfiehlt aber nichts.
3. Vor Änderung der Lohn-Engine: `rg -n "break" src/lib/lohn/pap-2026 src/lib/lohn/golden-master` — 0 Treffer bedeutet Fixtures haben Pause = 0, dann bit-identisch. Sonst §104-Halt.