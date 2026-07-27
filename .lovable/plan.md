## Ziel

Im Stammblatt-Bereich (PersonalDetailsTab) das Feld „Steuerklasse" nicht mehr als freies Textfeld, sondern als Dropdown mit den sechs deutschen Lohnsteuerklassen (I–VI) anzeigen.

## Scope

- Nur `src/components/admin/PersonalDetailsTab.tsx`.
- Keine Änderungen an Validierung, Persistenz oder Antragsflow — römische Persistenz (I–VI) besteht bereits (`normalizeRequestValue`/`validateTaxClass`) und wird beibehalten.

## Umsetzung

1. Zeilendefinition (Sektion „Steuer & Sozialversicherung"): `tax_class` erhält `type: "select"` plus eine Options-Liste `["I","II","III","IV","V","VI"]` mit Beschriftungen wie „I – ledig", „II – alleinerziehend", „III – verheiratet (Haupt)", „IV – verheiratet (gleich)", „V – verheiratet (Neben)", „VI – Nebenjob".
2. `FieldEditor` bekommt einen `select`-Zweig, der aus einer optional übergebenen `options`-Prop ein natives `<select>` rendert (gleicher Stil wie der bestehende Bool-Select). Leerer Wert = „—".
3. Anzeigemodus (nicht editing) bleibt wie gehabt: der gespeicherte römische Wert wird direkt gerendert; optional die Klartext-Bezeichnung dahinter in Klammern.
4. Keine weiteren Felder anfassen, keine Schemaänderung, keine Tests anzupassen (bestehende `profile-fields.test.ts` bleibt gültig).

## Nicht-Ziele

- Kein Redesign des Antragsformulars in `profil.tsx` (dort ist bereits ein Dropdown vorhanden).
- Keine Migration der bestehenden Daten.
