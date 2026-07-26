# Antrags-Historie pro Mitarbeiter mit Feld-Diff

## Wo

Neuer Tab **„Anträge"** in `src/routes/_authenticated/admin/staff.$staffId.tsx` (nur für Rolle `admin`, konsistent mit „Personaldaten"/„Dokumente"). Kein Eingriff in `personal-antraege.tsx` (offene Anträge dort bleiben unverändert).

## Datenquellen

- `staff_data_change_requests`: `id, status, payload, note, review_note, created_at, reviewed_at, reviewed_by` (per `staff_id`, DESC).
- `audit_log`: Einträge mit `entity='staff_data_change_requests'` und `entity_id = request.id`, Aktionen `profile.request_approved` / `profile.request_rejected`. Beim Approve enthält `meta.diff = { field: { before, after } }` die **tatsächlich übernommenen** Werte inklusive Normalisierung, `meta.manualOnly` die manuell zu übernehmenden Felder (first/last_name). Beim Reject `meta.fields`.
- `staff`-Join für Reviewer-Name (`reviewed_by → staff.display_name/first_name/last_name`).

## Server-Funktion

Neu in `src/lib/profile/profile-admin.functions.ts`:

```ts
export type ChangeRequestHistoryItem = {
  id: string;
  status: "pending" | "approved" | "rejected";
  createdAt: string;
  reviewedAt: string | null;
  reviewerName: string | null;
  note: string | null;
  reviewNote: string | null;
  fields: {
    field: string;           // z.B. "iban"
    requested: JsonPrimitive; // aus payload
    applied: JsonPrimitive | null; // aus audit meta.diff[field].after (null für pending/rejected/manualOnly)
    before: JsonPrimitive | null;  // aus audit meta.diff[field].before
    manualOnly: boolean;     // first_name/last_name → nicht persistiert
  }[];
};

export const listStaffChangeRequests = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator(z.object({ staffId: z.string().uuid() }).parse)
  .handler(async ({ data, context }): Promise<ChangeRequestHistoryItem[]> => { … });
```

Ablauf im Handler:
1. `loadAdminCaller(..., "admin")`, Org-Scope prüfen.
2. Requests des Mitarbeiters laden (DESC).
3. Für approved/rejected Requests: `audit_log` einmalig per `entity_id IN (…)` laden.
4. Pro Request: `payload`-Keys als Zeilenbasis; `applied/before` aus `audit.meta.diff` mappen; `manualOnly` aus `splitApplicableFields` bzw. `meta.manualOnly` ableiten.
5. Reviewer-Namen aus `staff`-Batch-Query.

## UI

Neue Komponente `src/components/admin/ChangeRequestsTab.tsx`:
- `useQuery(["admin","staff",staffId,"change-requests"], …)`.
- Chronologische Liste (neueste oben). Kopfzeile pro Antrag: Status-Badge (Übernahme mir bekanntem Muster aus `personal-antraege.tsx`), Beantragt-Datum, Freigabe-/Ablehnungs-Datum, Reviewer.
- Expand/Collapse Details (Details-Element): Tabelle mit Spalten **Feld · Vorher · Beantragt · Übernommen** + Notiz/Review-Notiz.
- `manualOnly`-Zeilen kursiv markiert („manuell zu übernehmen — nicht automatisch geschrieben").
- Feldnamen und -werte über bestehende Formatter aus `profile-fields.ts` (Label + Value-Rendering) rendern, damit z.B. Datumsfelder deutsch angezeigt werden.

Tab-Verkabelung: `Tab`-Union in `staff.$staffId.tsx` um `"antraege"` erweitern, Button „Anträge" (admin-only) hinzufügen, `{tab === "antraege" && isAdmin && <ChangeRequestsTab staffId={s.id} />}`.

## Zeitzonen / Formatierung

Datums-/Zeitangaben mit vorhandenem `formatDateTime`-Helper (Europe/Berlin) rendern; keine neue Zeitlogik.

## Nicht enthalten

- Keine Änderung an offener-Anträge-Ansicht.
- Kein Schreibpfad — reine Anzeige.
- Keine Schema-Migration; alle Daten liegen bereits in `staff_data_change_requests` und `audit_log`.
