// Antrags-Historie eines Mitarbeiters (Admin-Sicht).
// Zeigt pro Antrag: Status, Zeitpunkte, Reviewer, Notiz — sowie eine
// Feld-Tabelle mit Vorher/Beantragt/Übernommen. Rein lesend.

import { useQuery } from "@tanstack/react-query";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import {
  listStaffChangeRequests,
  type ChangeRequestHistoryItem,
} from "@/lib/profile/profile-admin.functions";

const FIELD_LABEL: Record<string, string> = {
  first_name: "Vorname",
  last_name: "Nachname",
  salutation: "Anrede",
  date_of_birth: "Geburtsdatum",
  place_of_birth: "Geburtsort",
  nationality: "Nationalität",
  bank_name: "Bank",
  iban: "IBAN",
  account_holder: "Kontoinhaber",
  social_security_number: "SV-Nummer",
  tax_id: "Steuer-ID",
  tax_class: "Steuerklasse",
  church_tax_liable: "Kirchensteuerpflichtig",
  konfession: "Konfession",
  children_count: "Anzahl Kinder",
  child_tax_allowances: "Kinderfreibeträge",
  health_insurance: "Krankenkasse",
};

function fieldLabel(k: string): string {
  return FIELD_LABEL[k] ?? k;
}

function fmtValue(v: string | number | boolean | null, field: string): string {
  if (v === null || v === undefined || v === "") return "—";
  if (typeof v === "boolean") return v ? "Ja" : "Nein";
  if (field === "date_of_birth" && typeof v === "string" && /^\d{4}-\d{2}-\d{2}$/.test(v)) {
    const d = new Date(v + "T00:00:00Z");
    if (!Number.isNaN(d.getTime())) {
      return d.toLocaleDateString("de-DE", { year: "numeric", month: "2-digit", day: "2-digit" });
    }
  }
  return String(v);
}

function fmtDateTime(iso: string | null | undefined): string {
  if (!iso) return "—";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "—";
  return d.toLocaleString("de-DE", {
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  });
}

function StatusBadge({ status }: { status: ChangeRequestHistoryItem["status"] }) {
  if (status === "approved")
    return <Badge className="bg-emerald-600 hover:bg-emerald-600">Freigegeben</Badge>;
  if (status === "rejected") return <Badge variant="destructive">Abgelehnt</Badge>;
  return <Badge variant="secondary">Offen</Badge>;
}

export function ChangeRequestsTab({ staffId }: { staffId: string }) {
  const q = useQuery({
    queryKey: ["admin", "staff", staffId, "change-requests"],
    queryFn: () => listStaffChangeRequests({ data: { staffId } }),
  });

  if (q.isLoading) return <p className="text-sm text-muted-foreground">Lade…</p>;
  if (q.isError)
    return (
      <p className="text-sm text-destructive">
        Fehler beim Laden: {q.error instanceof Error ? q.error.message : "Unbekannt"}
      </p>
    );
  const rows = q.data ?? [];
  if (rows.length === 0)
    return (
      <Card className="p-6 text-sm text-muted-foreground">
        Keine Stammdaten-Änderungsanträge vorhanden.
      </Card>
    );

  return (
    <div className="space-y-4">
      {rows.map((r) => (
        <RequestHistoryCard key={r.id} r={r} />
      ))}
    </div>
  );
}

function RequestHistoryCard({ r }: { r: ChangeRequestHistoryItem }) {
  const decidedLabel =
    r.status === "approved" ? "freigegeben" : r.status === "rejected" ? "abgelehnt" : null;
  return (
    <Card className="space-y-3 p-4">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="space-y-1">
          <div className="flex items-center gap-2">
            <StatusBadge status={r.status} />
            <span className="text-xs text-muted-foreground">
              beantragt {fmtDateTime(r.createdAt)}
            </span>
          </div>
          {decidedLabel && (
            <div className="text-xs text-muted-foreground">
              {decidedLabel} {fmtDateTime(r.reviewedAt)}
              {r.reviewerName ? ` durch ${r.reviewerName}` : ""}
            </div>
          )}
          {r.note && (
            <p className="mt-2 max-w-2xl text-sm text-foreground">
              <span className="text-xs uppercase tracking-wide text-muted-foreground">
                Anmerkung Mitarbeiter:
              </span>{" "}
              {r.note}
            </p>
          )}
          {r.reviewNote && (
            <p className="max-w-2xl text-sm text-foreground">
              <span className="text-xs uppercase tracking-wide text-muted-foreground">
                Anmerkung Admin:
              </span>{" "}
              {r.reviewNote}
            </p>
          )}
        </div>
      </div>

      <div className="overflow-x-auto rounded-md border border-border">
        <table className="w-full text-sm">
          <thead className="bg-muted/50 text-xs uppercase tracking-wide text-muted-foreground">
            <tr>
              <th className="px-3 py-2 text-left font-medium">Feld</th>
              <th className="px-3 py-2 text-left font-medium">Vorher</th>
              <th className="px-3 py-2 text-left font-medium">Beantragt</th>
              <th className="px-3 py-2 text-left font-medium">Übernommen</th>
            </tr>
          </thead>
          <tbody>
            {r.fields.map((f) => {
              const manual = f.manualOnly;
              return (
                <tr key={f.field} className="border-t border-border">
                  <td className="px-3 py-2 align-top text-foreground">
                    {fieldLabel(f.field)}
                    {manual && (
                      <span className="ml-2 text-[10px] uppercase tracking-wide text-muted-foreground">
                        manuell
                      </span>
                    )}
                  </td>
                  <td className="px-3 py-2 align-top text-muted-foreground">
                    {fmtValue(f.before, f.field)}
                  </td>
                  <td className="px-3 py-2 align-top text-foreground">
                    {fmtValue(f.requested, f.field)}
                  </td>
                  <td className="px-3 py-2 align-top">
                    {r.status === "approved" ? (
                      manual ? (
                        <span className="italic text-muted-foreground">
                          nicht automatisch übernommen
                        </span>
                      ) : (
                        <span className="text-foreground">
                          {fmtValue(f.applied ?? f.requested, f.field)}
                        </span>
                      )
                    ) : r.status === "rejected" ? (
                      <span className="text-muted-foreground">—</span>
                    ) : (
                      <span className="text-muted-foreground">offen</span>
                    )}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </Card>
  );
}
