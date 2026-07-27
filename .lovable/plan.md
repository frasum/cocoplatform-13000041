## PB2 — Pausen-Einstellung verdrahten (paidHours überall)

Vorgänger PB1 abgeschlossen (Spalte `organization_settings.pausen_bezahlt boolean NOT NULL DEFAULT TRUE`, aktuell `true`, kein Leser). LG3b wartet bis PB2 abgenommen ist.

### 1) Spec-Ablage
- `docs/PB2-pausen-verdrahtung.md` anlegen mit der vom Bauherrn gelieferten PB2-Spec (wortgleich).

### 2) Reines Modul
- Neu `src/lib/time/paid-hours.ts` mit `paidHours(grossHours, breakMinutes, pausenBezahlt) → number` (bei `false`: `max(0, grossHours − breakMinutes/60)`; bei `true`: `grossHours`).
- Tests `paid-hours.test.ts`: beide Schalterstellungen, 0-Kappung, `breakMinutes = 0` ⇒ identisch zu Alt.

### 3) Buchhaltungs-Pfad (`computeShiftHours`)
- `src/lib/time/shift-hours.ts`: Signatur um `breakMinutes: number` und `pausenBezahlt: boolean` erweitern; `totalHours = paidHours(...)`; SFN-Töpfe weiterhin über `applyBreakProration` (Import aus `lohn/time-entry-sfn.ts`, nicht nachbauen) — **unabhängig vom Schalter**.
- Aufrufer durchreichen: `src/lib/time/zeit-uebersicht-core.ts` (LG2-Aggregation) und `src/routes/_authenticated/admin/zeit-uebersicht.tsx` (×2). `pausenBezahlt` einmal pro Request aus `getOrgSettings` laden, nicht je Eintrag.
- Tests: Konsistenz Buchhaltung ↔ Export ↔ Lohn-Grundlohn für einen Fixture-Mitarbeiter unter beiden Schalterstellungen; Schalter-Invarianz der SFN-Töpfe.

### 4) Lohn-Engine
- `src/lib/lohn/compute-staff-sfn.ts` und `src/lib/lohn/lohn-period.functions.ts`: **Grundlohn-Stundenbasis** wird `paidHours(...)`. SFN-Geld-Berechnung bleibt unverändert (netto via `applyBreakProration`). Konsequenz bei `true`: Grundlohn brutto, Zuschläge netto — Lohnbüro-Auskunft 27.07.
- **Vorab-Verifikation (Auflage 3):** vor Änderung ein `rg -n "break" src/lib/lohn/pap-2026 src/lib/lohn/golden-master` laufen lassen. Bestätigt sich Pause=0 überall in den Fixtures: ein Satz im Bericht. Findet sich ein Fixture mit `break_minutes > 0`: §104-Halt, weil Schritt 4 dann Golden-Master-Ergebnisse verändert und die Nullmessung neu zu schneiden ist.

### 5) Buchhaltungs-Export
- `src/lib/time/buchhaltung-export.ts`: Stunden-Spalten (inkl. LG2 `stunden_gl/service/kueche`) folgen automatisch aus (3). Test `buchhaltung-export-columns.test.ts` um Doppel-Case (bezahlt/unbezahlt) erweitern; Alt-Monat mit Pause=0 byte-identisch (`buchhaltung-export-quarter.test.ts`).

### 6) Weitere Stundenbildner (Pfad-Korrektur, Auflage 1)
- `src/lib/time/my-period-hours.ts` (Selbstansicht) und **`src/lib/statistics/personnel-stats.functions.ts`** (Personalquote — korrigierter Pfad) heute hart netto → auf `paidHours` umstellen; SFN-freie Struktur bleibt. Tests entsprechend erweitern.
- §104-Meldepflicht: falls eine weitere Stundenbildner-Stelle auftaucht (Telegram-Report, Frag-COCO, TRMNL …), melden und listen, nicht still mit umstellen.

### 7) PB1-Dialog: Vorschau nachziehen
- Neue reine Server-Function (lesend), die Σ `break_minutes` der geschlossenen Einträge der laufenden Periode je Mitarbeiter summiert; Bestätigungsdialog in `ArbeitszeitSection.tsx` zeigt „Σ ⟨X⟩ h über ⟨N⟩ Mitarbeiter".

### 8) Nicht anfassen
`applyBreakProration`, `berechneSfnGeld`, `pap-2026/**`, Golden-Master; `staff_compensation_rates`/LG3a; PB1-Schalter/Audit außer Dialog-Vorschau.

### 9) Info-Text neutralisieren (Auflage 2)
- `src/components/settings/ArbeitszeitSection.tsx`: die Formulierung „sauber: „Pausen bezahlt = Nein". „Ja" ist zulässig, aber freiwillig günstiger …" entfernen. Ersatz: neutrale Beschreibung beider Wirkungen (wie in der PB1-Auftragsvorlage), ohne Empfehlung. Beide Stellungen legitim; der Text erklärt, was passiert — er empfiehlt nichts.
- Im Bericht nennen (Fundstelle + neuer Wortlaut). Volltext beim Bau nochmals auf weitere Default/Empfehlungs-Suggestionen prüfen; Funde ebenfalls neutralisieren.

### Erfolgs-Gate
- `prettier --write` + `eslint --fix`, `tsc 0 · eslint 0/0 · prettier clean`.
- `npx vitest run` grün; Vorzustand nur gemessen behaupten (Anker ≥ `32f73b21`, Ausgang 1910 Tests + neue).
- Blockierende Tests: `paidHours` (beide Stellungen + 0-Kappung); Schalter-Invarianz SFN-Töpfe; Konsistenz Buchhaltung/Export/Grundlohn; Bestandsverhalten `break_minutes = 0` bit-identisch.

### Klicktest (Bauherr)
1. LAM laufende Periode: Buchhaltung = Brutto (Schalter „bezahlt"), Lohn-Grundlohn identisch, SFN unverändert.
2. Schalter → „unbezahlt": Dialog zeigt Σ-Delta → bestätigen → Stunden sinken um Pausensumme, SFN gleich → zurückschalten.
3. Alt-Monat-Export vor/nach PB2: byte-identisch.
