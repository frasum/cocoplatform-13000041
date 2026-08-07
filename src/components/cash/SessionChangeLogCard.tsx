import { useQuery } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { listSessionChangeLog } from "@/lib/cash/cash.functions";
import { fmtCents } from "@/lib/format";
import type { SessionFieldChange } from "@/lib/cash/session-change-diff";

function fmtValue(c: SessionFieldChange, v: number | string | null): string {
  if (v === null) return "—";
  if (c.kind === "money") return `${fmtCents(v as number)} €`;
  if (c.kind === "count") return String(v);
  return String(v).trim() === "" ? "—" : String(v);
}

function fmtStamp(iso: string): string {
  return new Date(iso).toLocaleString("de-DE", {
    timeZone: "Europe/Berlin",
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}

/**
 * Änderungs-Log eines Geschäftstags: zeigt Wieder-Öffnungen (mit Grund) und
 * nachträgliche Änderungen mit Benutzer, Zeitpunkt und betroffenen Feldern.
 * Wird nur gerendert, wenn es Einträge gibt.
 */
export function SessionChangeLogCard({ sessionId }: { sessionId: string }) {
  const load = useServerFn(listSessionChangeLog);
  const q = useQuery({
    queryKey: ["session-change-log", sessionId],
    queryFn: () => load({ data: { sessionId } }),
  });

  const entries = q.data ?? [];
  if (entries.length === 0) return null;

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base">Änderungs-Log (nachträgliche Korrekturen)</CardTitle>
      </CardHeader>
      <CardContent className="space-y-4">
        {entries.map((e) => (
          <div key={e.id} className="border-border border-l-2 pl-3 text-sm">
            <div className="flex flex-wrap items-baseline gap-x-2">
              <span className="font-medium">
                {e.action === "cash.session.reopened"
                  ? "Session wieder geöffnet"
                  : "Nachträgliche Änderung"}
              </span>
              <span className="text-muted-foreground">
                {fmtStamp(e.createdAt)} · {e.actorName}
              </span>
            </div>
            {e.reason && <div className="text-muted-foreground">Grund: {e.reason}</div>}
            {e.changes.length > 0 && (
              <ul className="mt-1 space-y-0.5">
                {e.changes.map((c) => (
                  <li key={c.field} className="tabular-nums">
                    <span className="text-muted-foreground">{c.label}:</span>{" "}
                    {fmtValue(c, c.before)} →{" "}
                    <span className="font-medium">{fmtValue(c, c.after)}</span>
                  </li>
                ))}
              </ul>
            )}
          </div>
        ))}
      </CardContent>
    </Card>
  );
}
