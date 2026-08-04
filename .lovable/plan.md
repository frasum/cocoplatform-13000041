# FS1 — Session-Feld-Sichtbarkeit je Standort (FineDine bei YUM aus)

Basis: `origin/main` @ `6dae46854` („FineDine zu Struktur-Spalte gem.", EX2-c Option b).

Ausgangsbefund (verifiziert): FineDine wird als Session-Feld `sessions.finedine_vouchers_cents` erfasst (Eingabe in `SessionFieldsCard`, Label „Finedine-Gutscheine"); ein Katalog-Kanal existiert nicht. In `bargeld-export.ts` ist „FineDine" aktuell eine Struktur-Spalte ohne `channelKind`. Das Schalter-Muster liegt vor: `locations.cash_enabled` + `setLocationCashEnabled` + Schalter „Kassenbetrieb & Auswertungen" in `admin/locations.tsx`.

## Was gebaut wird

1. **Konfiguration am Standort**
   - Migrationsdatei (Skizze, Ausführung durch den Bauherrn): `locations.disabled_session_fields text[] NOT NULL DEFAULT '{}'` mit CHECK auf die erlaubten Schlüssel (heute: `'finedine'`).
   - Neuer Kern `src/lib/cash/session-fields.ts`: Schlüssel-Konstante (`SESSION_FIELD_KEYS` inkl. Label), reine Helfer `isSessionFieldEnabled(key, disabled)` und `sessionFieldVisible(key, disabled, rows)` (historischer Wert ⇒ sichtbar).

2. **Standort-Verwaltung (UI)**
   - Schalter-Gruppe „Kassenfelder" im Standort-Block, analog dem `cash_enabled`-Schalter; Server-Funktion `setLocationDisabledSessionFields` (admin, Audit-Eintrag wie bei `setLocationCashEnabled`). Damit setzt der Bauherr YUM = `{finedine}` ohne SQL.
   - `listLocations`/`AdminLocation` liefern `disabledSessionFields` mit.

3. **Kassenmaske**
   - `kasse.tsx` gibt die deaktivierten Feld-Schlüssel des gewählten Standorts an `SessionFieldsCard`; deaktivierte Felder werden nicht gerendert und beim Speichern mit 0 gesendet.
   - Verteidigung in der Tiefe: `updateSessionCore` lädt die Standort-Konfiguration und lehnt Werte ≠ 0 für deaktivierte Felder mit sprechendem Fehler ab („Feld ‚Finedine-Gutscheine' ist an diesem Standort deaktiviert."). Historische Werte bleiben unangetastet lesbar — nur das Schreiben ≠ 0 wird abgelehnt.

4. **Export EX2**
   - `BargeldSheet` erhält `disabledSessionFields`; die FineDine-Spalte bekommt einen `sessionFieldKey` und entfällt, wenn das Feld am Standort deaktiviert ist — dieselbe Wahrheit wie die Maske, keine eigene Export-Regel.
   - Wächter: trägt eine HISTORISCHE Zeile des Export-Monats einen Wert ≠ 0, erscheint die Spalte für diesen Monat doch (kein Geld verstecken); der Formeltreue-Wächter rechnet mit exakt den gezeigten Spalten.
   - `kasse-saldo.tsx` übergibt die Standort-Konfiguration beim Bauen der Blätter.

5. **DailyPrint / PDF**
   - `DailyPrintView` und `pdfExport` folgen derselben Feld-Sichtbarkeit (FineDine-Zeile entfällt bei deaktiviertem Feld, bleibt bei historischem Wert ≠ 0 sichtbar).

6. **Tests**
   - Pure Helfer: aktiv / deaktiviert / deaktiviert mit historischem Wert ⇒ Spalte doch.
   - Export: Blatt ohne FineDine-Spalte bei deaktiviertem Feld, Formeltreue unverändert; Juli-Fixture (spicery mit FineDine-Werten) unverändert korrekt.
   - Server-Ablehnung: `updateSessionCore` wirft bei Wert ≠ 0 auf deaktiviertem Feld.

## Nicht angefasst

Kanalkatalog/Landkarte (CH1), Gutschein-/Bargeldrechnung, EX2-b-Unten-Block, `pap-2026/**`.

## Abnahme

Vier Gates auf dem Liefer-SHA, `prettier --write` vor dem Commit, eine Runde = ein Commit. Danach: Migration ausführen, YUM-Schalter setzen; Sichtprüfung: YUM-Maske ohne FineDine-Feld, YUM-Blatt ohne Spalte, spicery unverändert, Juli-Export unverändert korrekt.