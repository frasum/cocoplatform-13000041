## Ergebnis der Diagnose

Coco hat im Abrechnungsmonat Juli **drei** Krank-Kalendertage in `roster_absence`:

- Fr, 24.07.2026 (Werktag) → zählt
- Sa, 25.07.2026 (Wochenende) → zählt nicht
- So, 26.07.2026 (Wochenende) → zählt nicht

Die Zusammenfassung zeigt daher **1 Tag krank**. Das ist korrekt nach der seit UZ1 v2 vereinbarten Regel:

> Krank- und Urlaubstage werden nach dem **5-Tage-Modell** gezählt — nur Mo–Fr. Sa/So werden übersprungen. Feiertage zählen als normale Werktage.

Die Regel ist bewusst zentral in `src/lib/time/urlaub-count.ts` implementiert und wird sowohl in der Zusammenfassung (`listAbsencesByStaff` in `src/lib/time/time-admin.functions.ts`) als auch im Buchhaltungs-Export als **einzige Zählquelle** genutzt.

## Entscheidung

Auf Wunsch (Antwort: „Alles bleibt so") **keine Code-Änderung**. Die Anzeige ist korrekt.

## Hinweis für die Zukunft

Falls die visuelle Diskrepanz zwischen „3 Kalendertagen im Dienstplan" und „1 Tag in der Zusammenfassung" wiederholt Verwirrung stiftet, wäre ein kleiner Anzeige-Hinweis (Tooltip an der Spalte „Krank") die naheliegende, risikoarme Option. Nicht Teil dieses Plans — bitte separat beauftragen.
