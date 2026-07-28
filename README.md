# Vereinte Gastronomie-Betriebsplattform

Neubau einer einzigen Anwendung, die die vier Bestandsprojekte
(`bunker-shift-flow`, `thaitime`, `tagesabrechnung`, `bestellung`) ablöst.

Stack: TanStack Start (React 19, Vite 7), Bun, Supabase, TypeScript strict.

## Status

Die Module M0–M5 sind gebaut und im Betrieb (Dienstplan produktiv als
alleinige Planungswahrheit, Bestellwesen live, Zeiterfassung und
Lohn-Rechenkern verifiziert); der Kassen-Tagesabschluss läuft im
Parallelbetrieb vor dem Cutover. Dazu: Rezeptur-Modul,
Betriebskalender/Schichtbetrieb/Trinkgeld-Modell (je Standort
konfigurierbar), Fehler-Monitoring.

Maßgeblich und stets aktuell:
[`docs/arbeitsweise.md`](docs/arbeitsweise.md) (Modul-Status,
Arbeitsweise, Stammdaten) ·
[`docs/produktionsreife-review.md`](docs/produktionsreife-review.md)
(Patch-Plan P0–P7, kritischer Pfad zum Go-live) ·
[`docs/saas-vorbereitung.md`](docs/saas-vorbereitung.md).

## Bauplan & Designentscheidungen

Maßgeblich ist [`docs/gruendungsdokument.md`](docs/gruendungsdokument.md).
Jede Abweichung von dort wird zuerst diskutiert, dann gebaut.

Laufendes Betriebshandbuch (Rollen, Review-Loop, Stammdaten, Modul-Status):
[`docs/arbeitsweise.md`](docs/arbeitsweise.md).

## Entwicklung

Lokale Entwicklung: `.env.example` nach `.env` kopieren und die Werte aus
dem Supabase-Projekt (bzw. `supabase status` für den lokalen Stack)
eintragen. `.env` ist in `.gitignore` und wird per CI-Guard gegen
Wieder-Committen geschützt.

```bash
bun install
bun run dev        # Vite/TanStack-Dev-Server
bun run test       # Vitest
bun run lint       # ESLint
bun run tsc --noEmit
bun run format:check  # Prettier-Drift erkennen (CI-Stufe)
bun run format:write  # Prettier-Drift beheben
```

## Formatierung & `.prettierignore`

`prettier --check .` läuft in CI vor `eslint` und `vitest`. Wer lokal
`bun run format:write` ausführt, behebt jeden Drift sofort.

`.prettierignore` schließt bewusst diese Pfade aus — Änderungen bitte
begründen:

| Eintrag                                                                         | Grund                                                                       |
| ------------------------------------------------------------------------------- | --------------------------------------------------------------------------- |
| `node_modules`                                                                  | Abhängigkeiten, nicht unser Code.                                           |
| `dist`, `dist-ssr/`, `.output`, `.vinxi`, `.nitro/`, `.tanstack/`, `.wrangler/` | Build- / SSR- / Cloudflare-Output, vollständig generiert.                   |
| `pnpm-lock.yaml`, `package-lock.json`, `bun.lock`                               | Lockfiles, vom Package-Manager verwaltet.                                   |
| `routeTree.gen.ts`                                                              | Wird vom TanStack-Router-Plugin geschrieben.                                |
| `src/integrations/supabase/types.ts`                                            | Wird von `supabase gen types` geschrieben.                                  |
| `.lovable/`                                                                     | Plan- und Session-Dateien des Lovable-Agents, regelmäßig überschrieben.     |
| `.env`, `.env.*.local`, `.dev.vars`                                             | Geheime/lokale Konfiguration — nie formatieren, nie committen.              |
| `*.csv`                                                                         | Datendumps; Personaldaten/CSVs gehören nicht ins Repo (Lektion `thaitime`). |
| `coverage/`                                                                     | Vitest-Coverage-Output.                                                     |
| `logs/`, `*.log`                                                                | Laufzeitlogs.                                                               |
| `.DS_Store`                                                                     | macOS-Finder-Müll.                                                          |

SQL-Dateien unter `supabase/migrations/` werden von Prettier ohnehin nicht
formatiert und sind deshalb nicht gelistet.

## RLS-Inventur

`scripts/check-rls-inventory.sql` listet öffentliche und bedingungslose
Policies. Wird in CI gegen die Migrationen geprüft.
