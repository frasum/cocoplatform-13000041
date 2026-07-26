## Ziel

Im Info-Block „Arbeitszeit" den Stundenlohn im Ann-Beispiel von 36,00 €/h auf **14,00 €/h** korrigieren (laut Personalakte). Alle abgeleiteten Werte in der Tabelle entsprechend neu rechnen.

## Neue Zahlen

| Kennzahl | Ja (heute) | Nein (PB2) |
|---|---|---|
| Bruttostunden | 167,30 h | 167,30 h |
| Fiktive ArbZG-Pause (22 × 30 min) | — | 11,00 h |
| Vergütungsstunden | 167,30 h | 156,30 h |
| Grundlohn (× 14,00 €/h) | 2.342,20 € | 2.188,20 € |
| Differenz | | **−154,00 €** |

SFN-Faktor bleibt (11,00 h ÷ 167,30 h ≈ 6,58 %). Nur die Euro-Beträge und die „× 36,00 €/h"-Beschriftung ändern.

## Technisches

- Einzige Datei: `src/components/settings/ArbeitszeitSection.tsx`.
- Vier Text-Ersetzungen in der Beispiel-Tabelle: 36 → 14, 6.022,80 → 2.342,20, 5.626,80 → 2.188,20, 396,00 → 154,00.
