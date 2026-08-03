# ZS1 — Überlappungs-Guard + „nicht mehr im Plan" sichtbar machen

Bestand: `origin/main` @ `225b58c8`.

## Teil 1 — Überlappungs-Guard

Neues reines Modul `src/lib/time/overlap.ts`:

- `overlaps(a, b)` auf echten Zeitstempeln, halb-offene Intervalle: Ende == Anfang der Folgeschicht ⇒ KEINE Überlappung. Mitternachts-Schichten (23:00–02:00) fallen damit automatisch korrekt aus, weil nicht auf Uhrzeit-Strings gerechnet wird.
- `findTimeConflict(existing[], candidate, excludeId?)` ⇒ `null | { kind: "identical" | "overlap", entry }`.
- Sprechende Fehlertexte im selben Modul:
  - identisch: „Für {Name} existiert an diesem Tag bereits ein Eintrag {HH:MM}–{HH:MM}."
  - überlappend: „Für {Name} überlappt dieser Eintrag mit einem bestehenden Eintrag {HH:MM}–{HH:MM}. Getrennte Doppelschichten sind möglich, Überlappungen nicht."

Verdrahtung in `src/lib/time/time-admin.functions.ts`, serverseitig, VOR Insert/Update und nach dem Sperr-Check:

- Gemeinsamer Helper `assertNoTimeConflict(...)`: lädt die Einträge derselben Person für Geschäftstag ± 1 Tag (deckt Wrap-Schichten ab), holt den Anzeigenamen für die Meldung, wirft bei Konflikt.
- Eingebaut in `createTimeEntryShift` und `setTimeEntryShift` (dort mit `excludeId` = eigene ID).
- `runBatchTimes` bleibt unverändert: `resolveBatchDay` aktualisiert bei vorhandenem Eintrag statt neu anzulegen, erzeugt also keine Duplikate. Wird hier nur festgehalten, nicht „mit erledigt".

Tests `src/lib/time/overlap.test.ts`: Grenzfall Ende==Anfang, identisch, echte Überlappung, 23:00–02:00 gegen 15:00–23:00 und gegen 01:00–03:00, `excludeId`.

## Teil 2 — „Nicht mehr im Plan" sichtbar machen (Variante b, konservativ)

Neues reines Modul `src/lib/roster/not-in-plan.ts`:

- `plannedKey(staffId, dateIso)` + `isNotInPlan(entry, plannedKeys)` ⇒ boolean.
- `isUntouched(input)` ⇒ boolean: kein gestempelter Ist-Eintrag (`source = 'clock'`), kein Trinkgeld-/Abrechnungsbezug (keine `waiter_settlements`-Zeile der Person in der Session), keine manuelle Übersteuerung (`note`, `participates`). Nur der reine Plan-Snapshot gilt als unberührt.
- `removalBlockedReason(...)` liefert den Tooltip-Text, wenn nicht unberührt.

Daten kommen im bestehenden Roundtrip mit (kein N+1):

- Kasse: `computeSessionTipPoolCore` (`src/lib/cash/cash.functions.ts`) lädt zusätzlich in EINEM Query die `roster_shifts` (Status `planned`/`confirmed`) für Standort + Geschäftstag; die vorhandenen Settlement-/Zeit-Reads werden weiterverwendet. Pro Pool-Eintrag kommen `notInPlan` und `removable` (+ `blockedReason`) mit.
- Wochenplan: `getWeeklyTimeEntries` lädt die Roster-Zeilen bereits; ergänzt wird nur die Plan-Menge (Status-Filter) und pro Eintrag `notInPlan` + `removable`. `getWeeklyTimeEntriesBatch` bekommt dieselben Felder, damit „Alle Standorte" gleich aussieht.

UI, dezent und ohne Auto-Löschen:

- Kassen-Kellnerliste (`TipPoolCard`): kleines Badge „nicht mehr im Plan" mit Tooltip; daneben Ein-Klick-Entfernen, aktiv nur bei `removable`. Sonst erklärt der Tooltip, warum nur bewusst-manuell entfernt werden kann.
- Wochenplan (`zeit-uebersicht.tsx` / Grid-Zelle): dasselbe Badge/Icon mit Tooltip und Ein-Klick-Entfernen bei unberührtem Eintrag.

Server-Seite des Ein-Klick-Entfernens — die Anzeige entscheidet NICHT:

- Kasse: neue Server-Function `removeUnplannedPoolEntry` — prüft Plan-Abwesenheit UND Unberührtheit erneut serverseitig, ruft dann `deleteSessionTipPoolEntryCore` (Sperren/Waterline/Audit unverändert).
- Wochenplan: neue Server-Function `removeUnplannedTimeEntry` — gleiche Doppelprüfung, ruft dann `_deleteTimeEntryCore` mit fester Begründung „nicht mehr im Dienstplan (unberührt)"; Audit-Trail wie bisher.

Tests `src/lib/roster/not-in-plan.test.ts`: Markierung, Unberührt-Matrix, Tooltip-Gründe.

## Teil 3 — Kommentar-Nachzug

Der Kopfkommentar in `src/lib/cash/roster-pool-sync.ts` verweist künftig auf die sichtbare Markierung „nicht mehr im Plan" samt Ein-Klick-Entfernen statt nur auf Laufkarte/manuelles Entfernen. Nur Kommentar, keine Logikänderung am additiven Nach-Sync.

## Nicht angefasst

Additiver Nach-Sync und seine Idempotenz, Pool-Defaults, SFN-/Lohnrechnung, gestempelte Ist-Zeiten, `pap-2026/**`.

## Erfolgs-Gate

`tsc --noEmit` 0 · `eslint . --max-warnings=0` 0 · `prettier --check .` clean · `vitest run` grün; `prettier --write` vor dem Commit; eine Runde = ein Commit.