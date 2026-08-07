# Warnung: Wolt-Betrag höher als Vectron-Takeaway

## Befund (geprüft)

- In der Tagesabrechnung zeigt `SettlementWarningsBanner` bereits zwei Warnungen (POS-Differenz, Terminal-Differenz), berechnet in der reinen Funktion `src/lib/cash/settlement-warnings.ts`.
- Fachlich steckt Wolt (`delivery_wolt`) im Vectron-Takeaway-Marker (`delivery_vectron`) — ist Wolt größer als der Marker, ist die Erfassung fehlerhaft.
- Die Statistik prüft das schon (`takeawayDonutSegments` → `woltExceedsMarker` in `src/lib/statistics/revenue-core.ts`); in der Kasse fehlt diese Prüfung.

## Was gebaut wird

Eine dritte Warnung im bestehenden roten Banner der Tagesabrechnung:

> **Wolt über Takeaway-Marker** — Wolt (2.240,00 €) übersteigt den Vectron-Takeaway-Betrag (240,00 €). Differenz: +2.000,00 €. Erfassung prüfen.

Verhalten:

- Erscheint unabhängig davon, ob Kellner-Abrechnungen vorhanden sind (im Unterschied zu den beiden bestehenden Warnungen, die Abrechnungen voraussetzen) — ein Erfassungsfehler soll sofort auffallen, auch direkt nach dem Eintippen der Kanäle.
- Erscheint nur, wenn Wolt strikt größer als der Vectron-Takeaway-Marker ist (Gleichstand ist erlaubt).
- Gleiche Optik und Position wie die bisherigen Warnungen; keine Blockade des Speicherns oder Finalisierens.

## Nicht Teil dieser Runde

- Keine Änderung an POS-/Terminal-Warnlogik, an der Umsatzzerlegung oder am PDF/Druck.
- Kein Hard-Block beim Speichern oder Finalisieren.

## Technische Details

- `src/lib/cash/settlement-warnings.ts`: neue Variante `{ kind: "wolt_exceeds_marker", woltCents, markerCents, diffCents }`; Input um `deliveryWoltCents` erweitert (ganzzahlige Cents, gleiche `asInt`-Validierung). Die Wolt-Prüfung läuft vor dem `hasSettlements`-Early-Return.
- `src/lib/cash/settlement-warnings.test.ts`: Fälle Wolt > Marker, Wolt = Marker, Wolt ohne Abrechnungen, Nicht-Ganzzahl wirft.
- `src/components/cash/SettlementWarningsBanner.tsx`: `deliveryWoltCents: agg.byKind.delivery_wolt` übergeben und neuen Listeneintrag rendern (`fmtCents`, `fmtSignedCents` wie bestehend).
- Gates: `tsc --noEmit`, `eslint . --max-warnings=0`, `prettier --check .`, `vitest run`.