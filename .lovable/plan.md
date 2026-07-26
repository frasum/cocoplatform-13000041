## Ziel

Im aufklappbaren Info-Block der Sektion „Arbeitszeit" einen weiteren aufklappbaren Unter-Absatz **„Beispiel Ann (Patchari Chaisiri) Juni 2026"** ergänzen. Anders als bei Sumitr werden hier die **gesetzlichen Mindestpausen nach ArbZG § 4** angesetzt, weil für Ann im Juni keine Pausen erfasst wurden. Reine Anzeige, keine Berechnungslogik im Produktivpfad.

Zusätzlich: Der Bauplan-Schritt **PB2** wird um eine Regel-Notiz ergänzt (nicht implementiert, nur dokumentiert), dass bei „Pausen bezahlt = Nein" fehlende erfasste Pausen durch die ArbZG-Mindestpause ersetzt werden.

## Rechenweg (fürs Beispiel Ann)

Pro Schicht wird anhand der Anwesenheitsdauer die fiktive Mindestpause bestimmt:

```text
Anwesenheit ≤ 6 h        → 0 min
6 h < Anwesenheit ≤ 9 h  → 30 min
Anwesenheit > 9 h        → 45 min
```

Verteilung der fiktiven Pause auf die SFN-Töpfe: **proportional** über die Schicht (wie bei erfassten Pausen). Reicht fürs Beispiel; die Feinjustage (Lage der Pause) ist explizit PB2-Thema.

Konkret berechnet für Anns Juni-Datensatz (23 Schichten, 167,30 h brutto):
- Summe fiktiver ArbZG-Pausen je Schicht ermitteln
- Nettostunden = Brutto − Σ fiktive Pausen
- Grundlohn-Differenz = (fiktive Pausenstunden) × 36 €/h
- Proportional gekürzte SFN-Töpfe (Abend/Nacht/Sonntag) als Zusatzhinweis

Die konkreten Zahlen werden zum Umsetzungszeitpunkt einmal per SQL-Read (Query gegen `time_entries` für Ann im Juni 2026) ermittelt und als **statischer Text** in die JSX geschrieben — dieselbe Vorgehensweise wie bei Sumitr. Keine Live-Berechnung im UI.

## Platzierung

`src/components/settings/ArbeitszeitSection.tsx` — im bestehenden `<details>`-Block „Wie werden Pausen gesetzlich berechnet?", **unter** dem bestehenden Sumitr-Beispiel, ein zweiter innerer `<details>`-Block:

- Summary: „Beispiel Ann Juni 2026 (ohne erfasste Pausen → gesetzliche Mindestpause)"
- Inhalt: kurze Erklärung (warum ArbZG-Mindestpause angesetzt wird) + Tabelle mit den vier Kennzahlen (Brutto, fiktive ArbZG-Pause gesamt, Netto, Grundlohn-Differenz bei 36 €/h) + ein Satz zur SFN-Auswirkung + ein Satz „Für PB2 vorgesehene Regel: bei ‚Pausen bezahlt = Nein' wird eine fehlende Pausen­erfassung durch die ArbZG-Mindestpause je Schicht ersetzt."

## Technisches

- Einzige Code-Datei: `src/components/settings/ArbeitszeitSection.tsx`. Nur JSX-Ergänzung.
- Keine neuen Props, keine Server-Fn, keine Migration, keine Teständerung.
- Klassen im vorhandenen Token-Stil (`bg-muted/40`, `border-border`, `text-muted-foreground`, `rounded-md`, `text-xs`).
- SQL-Read (nur Umsetzung, kein Persistenz-Schritt): `time_entries` × `staff` für Ann im Zeitraum 01.–30.06.2026, Aggregation nach Schichtlänge → fiktive Pausenminuten.
- PB2-Notiz: eine Zeile in `docs/arbeitsweise.md` (oder im vorhandenen Bauplan-Abschnitt zu PB2), dass die „ArbZG-Fallback-Pause" Teil von PB2 wird. Keine Code-Wirkung.
