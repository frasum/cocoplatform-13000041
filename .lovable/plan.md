## Ziel

In `src/components/settings/ArbeitszeitSection.tsx` einen aufklappbaren Info-Block einfügen, der die rechtliche Grundlage zu Pausenzeiten kurz erklärt — als Entscheidungshilfe neben der Ja/Nein-Auswahl. Reine Anzeige, keine Logik.

## Platzierung

Zwischen dem Sektions-Header („Arbeitszeit" + Untertitel) und dem `<fieldset>` mit den Radiobuttons. So sieht der Admin die Rechtslage, bevor er umschaltet.

## Darstellung

Eingeklappt per Default (`<details>` / `<summary>`), damit die Sektion kompakt bleibt. Summary-Zeile: „Wie werden Pausen gesetzlich berechnet?" mit dezentem Info-Icon-Look (muted background, border, gerundet — passend zu den vorhandenen Karten).

Aufgeklappt zeigt der Block folgende Inhalte in kurzen Absätzen:

- **ArbZG § 4 — Mindestpausen:** bis 6 h keine Pflichtpause; > 6 bis 9 h mind. 30 min; > 9 h mind. 45 min. Aufteilung in Abschnitte von je mind. 15 min zulässig. Nicht länger als 6 h am Stück ohne Pause.
- **Vergütung:** Das ArbZG regelt nur die Dauer, nicht die Bezahlung. Ruhepausen sind gesetzlich grundsätzlich unbezahlt (§ 611a BGB). Bezahlung nur, wenn Tarif-, Betriebs- oder Arbeitsvertrag es vorsieht — oder wenn es keine echte Pause, sondern eine Arbeitsunterbrechung (Wartezeit, Bereitschaft am Arbeitsplatz) ist.
- **Gastronomie-Praxis:** Kein einschlägiger Flächentarifvertrag mit Pausenvergütungspflicht. Üblich und rechtlich sauber: „Pausen bezahlt = Nein". „Ja" ist zulässig, aber freiwillig günstiger als das Gesetz verlangt.
- **Steuerlicher Hinweis (SFN, § 3b EStG):** SFN-Zuschläge sind nur auf tatsächlich geleistete Arbeitsstunden steuerfrei. Auf bezahlte Pausenminuten entfallende Zuschlagsanteile wären streng genommen nicht § 3b-fähig. Details/Umsetzung folgen in PB2.

Kein Fettdruck-Overkill; Schlüsselzahlen (30 min / 45 min / 6 h / 9 h) leicht hervorgehoben. Text auf Deutsch, konsistent mit dem Rest der Sektion.

## Technisches

- Einzige geänderte Datei: `src/components/settings/ArbeitszeitSection.tsx`.
- Keine neuen Props, keine Server-Änderung, keine Migration.
- Klassen im vorhandenen Design-Token-Stil (`bg-muted/40`, `border-border`, `text-muted-foreground`, `text-foreground`, `rounded-md`, `text-xs`/`text-sm`).
- `<details>` nativ, kein zusätzlicher shadcn-Baustein nötig.
- Prettier/ESLint/TSC laufen unverändert grün (nur JSX-Ergänzung).
