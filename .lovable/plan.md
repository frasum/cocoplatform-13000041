
## 1. Sofort-Wiederherstellung GIG SERVICE (Data-Change)

Einmalige Wiederherstellung der am 04.07.2026 genehmigten Werte aus dem Audit-Log zurück in `staff_personal_details` (Zeile `staff_id = 93e44abe-d1d8-4763-b0a6-63cea7313687`, `organization_id = 77838674-…`).

Werte laut Audit `profile.request_approved` (Request `b87636cd-…`):

| Feld | Wert |
|---|---|
| `date_of_birth` | `1993-03-03` |
| `place_of_birth` | `Thailand` |
| `nationality` | `Thai` |
| `health_insurance` | `AOK` |
| `bank_name` | `Vr Bank münchen Land eG` |
| `iban` | `DE22701664860000874230` |
| `account_holder` | `Narisara Asa-sa-na` |
| `tax_class` | `I` |

Umsetzung: ein `UPDATE public.staff_personal_details SET … WHERE staff_id = … AND organization_id = …` über das insert-Tool. Andere Spalten bleiben unangetastet. Vorname/Nachname sind `manualOnly` und werden nicht angerührt.

## 2. Ursachen-Fix im Speicherpfad (Sparse Patch)

### Diagnose

`src/components/admin/PersonalDetailsTab.tsx`:

- `mutation.mutationFn` ruft `toPatch(form)` und sendet **das gesamte Formular** an `upsertStaffPersonalDetails`.
- `toPatch` mappt jedes leere Eingabefeld (`raw === "" || raw === null`) auf `null` — für **alle** Felder, nicht nur die, die der Nutzer aktiv geleert hat.
- Der Server-Upsert schreibt jede übergebene Spalte. Ergebnis: sobald `form` einen leeren Wert für ein Feld enthält (z. B. weil es nach einem Remount/nachträglicher Approval noch mit dem alten leeren Stand geladen war, oder weil eine Sektion Felder aus anderen Sektionen nicht anzeigt), landet dort `NULL`.

Das erklärt den Zustand von GIG SERVICE: nach Approve wurden die Werte gesetzt, ein späterer Save der Personaldaten-Maske hat sie wieder auf `NULL` gedrückt (`updated_at = 2026-07-26 16:30:28`).

### Fix

Nur wirklich geänderte Felder senden ("sparse patch"):

1. Baseline speichern: `PersonalDetailsTab` merkt sich beim Betreten des Edit-Modus den geladenen Datenstand als `baseline: FormState`.
2. `toPatch` erhält zusätzlich diese Baseline und liefert **nur Keys zurück, deren normalisierter Wert sich gegenüber der Baseline unterscheidet**.
3. Ein aktiv geleertes Feld (Baseline hatte Wert, Formular jetzt `""`) → weiterhin `null` im Patch, so wie es sein soll.
4. Ein Feld, das schon vorher `null` war und weiterhin leer ist → **nicht** im Patch → wird auf dem Server nicht überschrieben.
5. Der `vacMutation`-Pfad war bereits sparse (nur `VACATION_KEYS`) und bleibt so.
6. Wenn kein Feld geändert wurde: Mutation überspringen und Modal einfach schließen (Meldung „Keine Änderungen.").

### Server-seitige Zusatzhärtung

`upsertStaffPersonalDetails` (`src/lib/admin/personal-details.functions.ts`) macht aktuell einen Full-Upsert. Ergänzung:

- Wenn `data.fields` leer ist → früh mit `{ ok: true }` zurückkehren, keinen Upsert, keinen Audit-Eintrag.
- Der Upsert selbst bleibt so, aber nur mit tatsächlich übergebenen Keys — das ist mit einem Sparse-Patch vom Client automatisch der Fall.

## 3. Verifikation

- Nach der Data-Migration in `/admin/staff/93e44abe-…` → Tab „Persönlich": Geburtsdatum, Geburtsort, Nationalität, Krankenkasse, Bankdaten und Steuerklasse sichtbar.
- Reproduktionstest zum Fix: Personaldaten-Tab öffnen, ein einzelnes Feld ändern, speichern → nur dieses Feld ändert sich in `staff_personal_details`, alle anderen Werte (Bank, Geburtsdaten, …) bleiben erhalten.
- `bunx tsgo --noEmit` grün.

## 4. Nicht Teil dieses Schritts

- Kein Schema-Change an `staff_personal_details`.
- Keine Änderung an der Approve-Logik (`decideChangeRequest`).
- Keine UI-Umbauten am Antrags-Verlauf-Tab.
