## Diagnose

Die Sparse-Patch-Absicherung im Client ist intakt. Der Wipe passiert **serverseitig** in `src/lib/admin/personal-details.functions.ts` beim Input-Validieren:

```
inputValidator: personalDetailsSchema.parse(v.fields)
```

`personalDetailsSchema` ist ein `z.object({...})`, bei dem jedes Feld
`.optional().transform(v => v === undefined ? null : v)` ist. Das heißt: übergibt der Client einen sparsen Patch (z. B. nur `{ tax_class: "III" }`), füllt Zod **alle 28 anderen Felder mit `null` auf**. Der anschließende `upsert(..., { onConflict: "staff_id" })` schreibt genau diese Nulls in die Zeile und leert Adresse, IBAN, Bank, Tax-ID, SV-Nr., Urlaubstage usw.

Beweis im Audit-Log: alle 4 Speichervorgänge zwischen 07:54 und 07:57 melden **jedes** Feld als `changed:true` — obwohl der Client (nach BU-Fix) nur wenige Felder gesendet hat.

## Ziel

Sparse-Save darf ausschließlich die tatsächlich mitgeschickten Felder anfassen. Alle anderen Werte bleiben in der DB unangetastet.

## Änderungen (nur Personaldaten-Pfad)

1. **`src/lib/admin/personal-details.schema.ts`**
   - Neues Export: `personalDetailsPatchSchema = personalDetailsSchema.partial().strict()` — validiert Sparse-Patches feldweise (Format, Länge, IBAN-Regex, PLZ-Regex, Datum), lässt aber ausgelassene Felder **weg** statt sie mit `null` zu belegen.
   - Bestehendes `personalDetailsSchema` bleibt für Voll-Reads/Formstate erhalten.

2. **`src/lib/admin/personal-details.functions.ts` → `upsertStaffPersonalDetails`**
   - `inputValidator` nutzt `personalDetailsPatchSchema` statt `personalDetailsSchema`.
   - Zusätzliche Sicherung: nach dem Parse `Object.keys(parsed)` gegen die Input-Keys schneiden, damit selbst bei Schema-Regressionen keine Fremd-Nulls durchrutschen (Defense in Depth).
   - Der No-Op-Check (`length === 0 → early return`) bleibt.

3. **`src/components/admin/PersonalDetailsTab.tsx`**
   - Client-Vorvalidierung (`personalDetailsSchema.parse(patch)` in `mutation`/`vacMutation`) auf `personalDetailsPatchSchema.parse(patch)` umstellen, damit dieselbe Sparse-Semantik gilt und keine irreführenden Zod-Errors kommen.

4. **Datenrettung**
   - Wiederherstellen der zuletzt bekannten Werte für Narisara Asa-sa-na (`93e44abe-…`) aus dem Audit-Log-Verlauf (Adresse, Mail, Telefon, Konto, SV, Steuer, Urlaub) — analog zum Restore vom 27.07. vormittags, nachdem der Fix live ist.

## Bewusst NICHT im Scope

- Kein Umbau der UI-Sektionen, keine weiteren Feld-Änderungen.
- Kein Anfassen von `getStaffPersonalDetails` oder Compensation.
- Keine Migration — Fix ist rein anwendungslogisch.

## Verifikation

- `bunx tsgo` gegen die geänderten Dateien.
- Unit-Test (neu): `personalDetailsPatchSchema.parse({ tax_class: "III" })` liefert genau `{ tax_class: "III" }`, nicht 28 Felder.
- Manuell im Preview: eine einzelne Zeile ändern, speichern, Seite neu laden → alle anderen Felder bleiben stehen; Audit-Log meldet nur das eine Feld als geändert.
