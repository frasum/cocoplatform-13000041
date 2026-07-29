## Ziel

`SENTRY_AUTH_TOKEN`, `SENTRY_ORG`, `SENTRY_PROJECT` so hinterlegen, dass `@sentry/vite-plugin` beim Publish-Build Source-Maps hochlädt.

## Situation laut Screenshot

Workspace-Settings → **Build & deploy** enthält bei dir NUR „Git" (GitHub-Sync). Ein eigener „Build Secrets"-Bereich (siehe Lovable-Doku) ist in eurem Plan/Workspace nicht sichtbar. Damit fällt der „Workspace Build Secrets"-Weg aus.

## Vorschlag: Projekt-Secrets via Lovable

Lovable-Projekt-Secrets (`secrets--add_secret`) werden beim Publish-Build als `process.env.*` bereitgestellt — genau das, was `vite.config.ts` schon liest:

```ts
const sentryAuthToken = process.env.SENTRY_AUTH_TOKEN;
const sentryOrg       = process.env.SENTRY_ORG;
const sentryProject   = process.env.SENTRY_PROJECT;
const sentryEnabled   = Boolean(sentryAuthToken && sentryOrg && sentryProject);
```

Schritte:

1. Über `secrets--add_secret` die drei Namen anlegen (öffnet dein sicheres Formular — Werte gibst du selbst ein, ich sehe sie nie):
   - `SENTRY_AUTH_TOKEN` (Format-Hint `sntrys_...` / `<64-hex>`)
   - `SENTRY_ORG` (Slug, z. B. `cocoplatform`)
   - `SENTRY_PROJECT` (Slug, z. B. `cocoplatform-web`)
2. Danach ein normales **Publish**. Der Vite-Plugin sieht die drei Werte und lädt die Maps zu Sentry hoch (Release = Commit-SHA).

## Verifikation nach dem nächsten Publish

- Sentry → **Releases**: neuer Release-Eintrag mit Commit-SHA + hochgeladenen Artifacts.
- In Sentry-Issues: Stackframes zeigen echte `src/…`-Zeilennummern statt Bundle-Positionen.

## Falls Projekt-Secrets im Vite-Build doch nicht greifen

(Unwahrscheinlich, aber sauber:) Fallback ist ein CI-Build via GitHub-Actions-Secrets — dafür würde ich `.github/workflows/ci.yml` um einen `build`-Job erweitern. Erst machen, wenn Weg 1 nachweislich keine Maps hochlädt.

## Was ich vorbereite, sobald du zustimmst

- Aufruf `secrets--add_secret` für die drei Namen (mit Format-Hints).
- Kurze Post-Publish-Checkliste als Antwort, damit du den Upload in Sentry gegenprüfen kannst.

Keine Code-Änderung nötig — der Vite-Plugin ist bereits verdrahtet.