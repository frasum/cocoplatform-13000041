## PB2 Runde 2 — Abschluss (Freigabe mit drei Auflagen eingearbeitet)

Ziel: Zwischenstand schließen, damit Buchhaltung, Export, Lohn-Grundlohn und Selbstansicht wieder auf **einer** Vergütungsstunden-Regel (`paidHours`) sitzen. Kein Publish vor Abnahme. Ausgangsmessung: 1918 Tests, Anker `f506d576`, ESLint-Warnung als bekannter roter Start.

### Reihenfolge (bindend, weil CI rot ist)

**0) Sofort: `useMemo`-Deps reparieren** — `src/routes/_authenticated/admin/zeit-uebersicht.tsx`, useMemo endend ~Zeile 1059: `pausenBezahlt` (verwendet Zeile 1004) ins Dependency-Array aufnehmen. Ohne diesen Fix bleibt `--max-warnings=0` rot; alle weiteren Schritte scheitern am Gate.

**1) Info-Text neutralisieren (Auflage 2 aus Runde 1)** — `src/components/settings/ArbeitszeitSection.tsx` Zeile 83 + Volltext-Scan auf weitere Default-/Empfehlungs-Formulierungen: Empfehlungssatz zu „Pausen bezahlt = Nein" entfernen, ersetzen durch neutrale Beschreibung beider Wirkungen ohne Bewertung. Fundstellen + alter/neuer Wortlaut in den Bericht.

**2) Golden-Master-Beleg (Auflage 3 aus Runde 1, Pfade korrigiert — Auflage 1 dieser Runde)** — Pfade zuerst mit `ls` belegen, dann grep, beide Ausgaben wörtlich in den Bericht:

```
ls -d pap-2026 src/lib/lohn/golden-master
rg -n "break" pap-2026 src/lib/lohn/golden-master
```

Ein leeres `rg`-Ergebnis zählt nur, wenn `ls` beide Pfade als vorhanden gemeldet hat — sonst wäre der Beleg ein falsch-positives „kein Fund". Bei Fund von `break_minutes > 0` in Fixtures: sofort §104-Meldung, Schritt 3 anhalten.

**3) Lohn-Engine — Grundlohnbasis (Planschritt 4, Auflage 2 dieser Runde)** — IO-Rand ausschließlich in `src/lib/lohn/lohn-period.functions.ts`: `pausen_bezahlt` einmal aus `organization_settings` laden (Org-ID via `staff.organization_id`) und `totalHours` der Grundlohnbasis über `paidHours(...)` bilden. `src/lib/lohn/compute-staff-sfn.ts` **bleibt rein** — nimmt `pausenBezahlt` bei Bedarf als Parameter, lädt selbst nichts. `applyBreakProration` / `berechneSfnGeld` unverändert (SFN weiter netto). Konsequenz bei `true`: Grundlohn brutto, Zuschläge netto — Lohnbüro-Auskunft 27.07.

**4) Selbstansicht (Planschritt 6, Teil A)** — `src/lib/time/my-period-hours.ts` + Test: reine Funktionen nehmen `pausenBezahlt` als Parameter und rufen `paidMinutes(gross, break, pausenBezahlt)`. Aufrufer (`src/routes/_authenticated/zeit/stunden.tsx`, ggf. `time.functions.ts`) reichen das Flag durch, geladen einmalig per `getOrgSettings`. Tests: beide Stellungen, 0-Kappung, `break = 0` bit-identisch zu Alt.

**5) Personalquote (Planschritt 6, Teil B, korrigierter Pfad)** — `src/lib/statistics/personnel-stats.functions.ts`: `loadWindow` verwendet `paidMinutes(...)` statt hartem `max(0, gross - break)`. `pausenBezahlt` einmal je Request laden. Tests entsprechend erweitern. Weitere Stundenbildner (Telegram-Report, Frag-COCO, TRMNL): melden statt still umstellen (§104).

**6) Provision — Verhaltens-Einfrierung (Auflage 3 dieser Runde)** — `src/lib/lohn/provision.functions.ts`: `paidMinutes(..., false)` explizit setzen, mit ehrlichem Kommentar:

> Eingefroren auf Bestandsverhalten: Provision rechnet unabhängig vom `pausen_bezahlt`-Schalter mit Netto-Minuten. Ob Provisions-/Trinkgeldstunden dem Pausen-Schalter folgen sollen, ist eine offene Bauherren-Frage — keine steuerliche Notwendigkeit.

**7) Buchhaltungs-Export Doppel-Case-Tests (Planschritt 5)** — `src/lib/time/buchhaltung-export.ts` folgt automatisch aus Runde 1. Test `buchhaltung-export-columns.test.ts` um Fixture-Paar (bezahlt/unbezahlt) erweitern; `buchhaltung-export-quarter.test.ts` Alt-Monat mit Pause=0 bit-identisch prüfen.

**8) Dialog-Vorschau (Planschritt 7)** — Neue lesende Server-Function: Σ `break_minutes` der geschlossenen Einträge der laufenden Periode je Mitarbeiter. `ArbeitszeitSection.tsx` Bestätigungsdialog zeigt „Σ ⟨X⟩ h über ⟨N⟩ Mitarbeiter" beim Umschalten.

### Erfolgs-Gate

- `prettier --write` + `eslint --fix`; `tsc 0 · eslint 0/0 · prettier clean` (max-warnings=0).
- `npx vitest run` grün; Ausgangs-Anker `f506d576` mit 1918 Tests + neue.
- Blockierende Tests: `paidHours`/`paidMinutes` beide Stellungen + 0-Kappung; SFN-Schalter-Invarianz; Konsistenz Buchhaltung ↔ Export ↔ Grundlohn; Bestand `break_minutes = 0` bit-identisch (Export-Quarter).
- Nicht anfassen: `applyBreakProration`, `berechneSfnGeld`, `pap-2026/**`, Golden-Master, `staff_compensation_rates`/LG3a, PB1-Schalter/Audit (außer Dialog-Vorschau).
- **Kein Publish.** Bericht mit: Info-Text alt/neu, `ls`+`rg`-Ausgabe wörtlich, tsc/eslint/vitest-Zählern, Klicktest-Vorschlag.

### Klicktest (nach Abnahme)

1. LAM laufende Periode: Buchhaltung brutto (Schalter Ja), Lohn-Grundlohn identisch, SFN unverändert.
2. Schalter → Nein: Dialog zeigt Σ-Delta → bestätigen → Stunden sinken um Pausensumme, SFN gleich → zurückschalten.
3. Alt-Monat-Export vor/nach PB2: bit-identisch.
